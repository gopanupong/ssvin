import express from "express";
import multer from "multer";
import { google } from "googleapis";
import { Pool } from "pg";
import { GoogleGenAI, Type } from "@google/genai";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { Readable } from "stream";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const PORT = 3000;
// Use memoryStorage so files are never written to Vercel's disk
const upload = multer({ storage: multer.memoryStorage() });

// Database Pool (Lazy initialization to prevent crash on Vercel if URL is missing)
let dbPool: Pool | null = null;

function getDbPool() {
  if (dbPool) return dbPool;
  if (!process.env.DATABASE_URL) return null;
  try {
    dbPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    return dbPool;
  } catch (err) {
    console.error("Failed to create DB pool:", err);
    return null;
  }
}

async function initDb() {
  const pool = getDbPool();
  if (!pool) {
    console.warn("DATABASE_URL not found. Database features will be disabled.");
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inspection_logs (
        id SERIAL PRIMARY KEY,
        employee_id TEXT NOT NULL,
        substation_name TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        gps_lat DOUBLE PRECISION,
        gps_lng DOUBLE PRECISION,
        folder_id TEXT,
        status TEXT DEFAULT 'completed'
      );
      CREATE TABLE IF NOT EXISTS substation_master_folders (
        substation_name TEXT PRIMARY KEY,
        folder_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS health_index_logs (
        substation_name TEXT NOT NULL,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        status TEXT NOT NULL,
        findings TEXT[],
        summary TEXT,
        analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (substation_name, month, year)
      );
    `);
    
    // Add columns dynamically for Health Index Weights & N/A
    const columns = [
      "battery_score INT DEFAULT 100",
      "battery_na BOOLEAN DEFAULT FALSE",
      "yard_score INT DEFAULT 100",
      "yard_na BOOLEAN DEFAULT FALSE",
      "checklist_score INT DEFAULT 100",
      "checklist_na BOOLEAN DEFAULT FALSE",
      "roof_score INT DEFAULT 100",
      "roof_na BOOLEAN DEFAULT FALSE",
      "fence_score INT DEFAULT 100",
      "fence_na BOOLEAN DEFAULT FALSE",
      "security_score INT DEFAULT 100",
      "security_na BOOLEAN DEFAULT FALSE"
    ];
    for (const col of columns) {
      try {
        await pool.query(`ALTER TABLE health_index_logs ADD COLUMN IF NOT EXISTS ${col}`);
      } catch (colErr) {
        console.warn(`Could not add column ${col}:`, colErr);
      }
    }

    console.log("PostgreSQL initialized.");
  } catch (err) {
    console.error("Failed to initialize database:", err);
  }
}

const recentSubmissions = new Map<string, number>();
const folderCreationLocks = new Set<string>();

// Google Drive & Sheets Setup
const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets"
];

// Helper for Gemini API with retry logic
async function generateContentWithRetry(ai: GoogleGenAI, params: any, maxRetries = 5) {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`Gemini API Attempt ${i + 1}/${maxRetries}...`);
      const result = await ai.models.generateContent(params);
      console.log(`Gemini API Attempt ${i + 1} succeeded.`);
      return result;
    } catch (err: any) {
      lastError = err;
      const errorStr = JSON.stringify(err);
      console.error(`Gemini API Attempt ${i + 1} failed:`, err.message || errorStr);
      
      const isRetryable = 
        err.status === 'UNAVAILABLE' || 
        err.code === 503 || 
        err.status === 'RESOURCE_EXHAUSTED' || 
        err.code === 429 ||
        errorStr.includes("503") ||
        errorStr.includes("UNAVAILABLE") ||
        errorStr.includes("overloaded");

      if (isRetryable && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 3000 + Math.random() * 1000;
        console.log(`Gemini API busy. Retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// OAuth2 Client Setup
function getOAuth2Client() {
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${appUrl}/api/auth/google/callback`;
  
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error("Missing Google Client ID or Secret");
  }
  
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

// Google Sheets Helper for AI Analysis History
let historyCache: { data: any[], timestamp: number } | null = null;
const CACHE_TTL = 30000; // 30 seconds

async function getAnalysisHistory() {
  if (historyCache && (Date.now() - historyCache.timestamp < CACHE_TTL)) {
    return historyCache.data;
  }
  
  const auth = getGoogleAuth();
  if (!auth) return [];
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return [];

  try {
    console.time("FetchHistory");
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "AI_Analysis!A:G",
    }, { timeout: 15000 }); // 15s timeout for history fetch
    console.timeEnd("FetchHistory");
    const rows = response.data.values || [];
    const data = rows.slice(1).map(row => ({
      fileId: row[0],
      fileName: row[1],
      folderId: row[2],
      status: row[3],
      findings: row[4] ? row[4].split(',') : [],
      summary: row[5],
      analyzedAt: row[6]
    }));
    
    historyCache = { data, timestamp: Date.now() };
    return data;
  } catch (err: any) {
    if (err.code === 404 || (err.response && err.response.status === 400)) {
      await initAnalysisSheet();
    }
    return [];
  }
}

async function initAnalysisSheet() {
  const auth = getGoogleAuth();
  if (!auth) return;
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return;

  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId }, { timeout: 10000 });
    const sheetExists = spreadsheet.data.sheets?.some(s => s.properties?.title === "AI_Analysis");

    if (!sheetExists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: { properties: { title: "AI_Analysis" } }
          }]
        }
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "AI_Analysis!A1:G1",
        valueInputOption: "RAW",
        requestBody: {
          values: [["File ID", "File Name", "Folder ID", "Status", "Findings", "Summary", "Analyzed At"]]
        }
      });
    }
  } catch (err) {
    console.error("Failed to init analysis sheet:", err);
  }
}

async function saveAnalysisResult(result: any) {
  const auth = getGoogleAuth();
  if (!auth) return;
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return;

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "AI_Analysis!A:G",
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        result.fileId,
        result.fileName,
        result.folderId,
        result.status,
        result.findings.join(','),
        result.summary,
        new Date().toISOString()
      ]]
    }
  }, { timeout: 10000 });
}

// --- Google Sheets database Tab Helpers for persistent audits ---
async function initDatabaseSheet() {
  const auth = getGoogleAuth();
  if (!auth) return;
  const sheetsService = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID || "1WpvuQnhXzufiBmSRSaEnkRFs9BJf5H4fIWZ0xoYC8iw";
  if (!spreadsheetId) return;

  try {
    const spreadsheet = await sheetsService.spreadsheets.get({ spreadsheetId });
    const sheetExists = spreadsheet.data.sheets?.some(s => s.properties?.title === "database");

    if (!sheetExists) {
      await sheetsService.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: { properties: { title: "database" } }
          }]
        }
      });
      await sheetsService.spreadsheets.values.update({
        spreadsheetId,
        range: "database!A1:S1",
        valueInputOption: "RAW",
        requestBody: {
          values: [[
            "Substation Name", "Month", "Year", "Status", "Findings", "Summary", "Analyzed At", 
            "Battery Score", "Battery N/A", 
            "Yard Score", "Yard N/A", 
            "Checklist Score", "Checklist N/A", 
            "Roof Score", "Roof N/A", 
            "Fence Score", "Fence N/A", 
            "Security Score", "Security N/A"
          ]]
        }
      });
    }
  } catch (err) {
    console.error("Failed to init database sheet:", err);
  }
}

async function getHealthIndexFromSheet(): Promise<any[]> {
  const auth = getGoogleAuth();
  if (!auth) return [];
  const sheetsService = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID || "1WpvuQnhXzufiBmSRSaEnkRFs9BJf5H4fIWZ0xoYC8iw";
  if (!spreadsheetId) return [];

  try {
    const response = await sheetsService.spreadsheets.values.get({
      spreadsheetId,
      range: "database!A:S"
    });
    const rows = response.data.values || [];
    if (rows.length <= 1) return [];

    return rows.slice(1).map(row => {
      return {
        substation_name: row[0] || "",
        month: parseInt(row[1]) || 1,
        year: parseInt(row[2]) || 2026,
        status: row[3] || "Green",
        findings: row[4] ? row[4].split(",") : [],
        summary: row[5] || "",
        analyzed_at: row[6] || "",
        battery_score: row[7] !== undefined && row[7] !== "" ? parseInt(row[7]) : 100,
        battery_na: row[8] ? (row[8] === "TRUE" || row[8] === "true" || row[8] === "1") : false,
        yard_score: row[9] !== undefined && row[9] !== "" ? parseInt(row[9]) : 100,
        yard_na: row[10] ? (row[10] === "TRUE" || row[10] === "true" || row[10] === "1") : false,
        checklist_score: row[11] !== undefined && row[11] !== "" ? parseInt(row[11]) : 100,
        checklist_na: row[12] ? (row[12] === "TRUE" || row[12] === "true" || row[12] === "1") : false,
        roof_score: row[13] !== undefined && row[13] !== "" ? parseInt(row[13]) : 100,
        roof_na: row[14] ? (row[14] === "TRUE" || row[14] === "true" || row[14] === "1") : false,
        fence_score: row[15] !== undefined && row[15] !== "" ? parseInt(row[15]) : 100,
        fence_na: row[16] ? (row[16] === "TRUE" || row[16] === "true" || row[16] === "1") : false,
        security_score: row[17] !== undefined && row[17] !== "" ? parseInt(row[17]) : 100,
        security_na: row[18] ? (row[18] === "TRUE" || row[18] === "true" || row[18] === "1") : false
      };
    });
  } catch (err: any) {
    if (err.code === 404 || (err.response && err.response.status === 400)) {
      await initDatabaseSheet();
    }
    return [];
  }
}

async function saveHealthIndexToSheet(data: any) {
  const auth = getGoogleAuth();
  if (!auth) return;
  const sheetsService = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID || "1WpvuQnhXzufiBmSRSaEnkRFs9BJf5H4fIWZ0xoYC8iw";
  if (!spreadsheetId) return;

  try {
    await initDatabaseSheet();

    // Check if conflicting row matches substationName, month, year
    const getResponse = await sheetsService.spreadsheets.values.get({
      spreadsheetId,
      range: "database!A:S"
    });
    const rows = getResponse.data.values || [];
    
    let foundIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const sName = rows[i][0];
      const m = parseInt(rows[i][1]);
      const y = parseInt(rows[i][2]);
      if (sName === data.substationName && m === parseInt(data.month) && y === parseInt(data.year)) {
        foundIndex = i;
        break;
      }
    }

    const rowData = [
      data.substationName,
      String(data.month),
      String(data.year),
      data.status || "Green",
      Array.isArray(data.findings) ? data.findings.join(",") : (data.findings || ""),
      data.summary || "",
      new Date().toISOString(),
      data.battery_score !== undefined ? String(data.battery_score) : "100",
      data.battery_na ? "TRUE" : "FALSE",
      data.yard_score !== undefined ? String(data.yard_score) : "100",
      data.yard_na ? "TRUE" : "FALSE",
      data.checklist_score !== undefined ? String(data.checklist_score) : "100",
      data.checklist_na ? "TRUE" : "FALSE",
      data.roof_score !== undefined ? String(data.roof_score) : "100",
      data.roof_na ? "TRUE" : "FALSE",
      data.fence_score !== undefined ? String(data.fence_score) : "100",
      data.fence_na ? "TRUE" : "FALSE",
      data.security_score !== undefined ? String(data.security_score) : "100",
      data.security_na ? "TRUE" : "FALSE"
    ];

    if (foundIndex !== -1) {
      // 1-indexed for Sheets, foundIndex as 0-indexed translates to foundIndex + 1
      const range = `database!A${foundIndex + 1}:S${foundIndex + 1}`;
      await sheetsService.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [rowData]
        }
      });
      console.log(`Updated existing row for ${data.substationName} in Google Sheets database (row ${foundIndex + 1})`);
    } else {
      await sheetsService.spreadsheets.values.append({
        spreadsheetId,
        range: "database!A:S",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [rowData]
        }
      });
      console.log(`Appended new row for ${data.substationName} in Google Sheets database`);
    }
  } catch (sheetErr) {
    console.error("Failed to save health index to Google Sheets: database", sheetErr);
    throw sheetErr;
  }
}

// Route to start OAuth flow
app.get("/api/auth/google", (req, res) => {
  console.log("Starting Google OAuth flow...");
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const appUrl = process.env.APP_URL;

    if (!clientId || !clientSecret || !appUrl) {
      console.error("Missing required environment variables for OAuth");
      return res.status(400).send(`
        <div style="font-family: sans-serif; padding: 20px; color: #e11d48; background: #fff1f2; border-radius: 8px; border: 1px solid #ffe4e6; max-width: 500px; margin: 40px auto;">
          <h3 style="margin-top: 0;">❌ ตั้งค่าไม่ครบถ้วน</h3>
          <p>กรุณาตรวจสอบว่าได้ใส่ค่าเหล่านี้ใน Vercel Environment Variables หรือยัง:</p>
          <ul>
            <li><b>GOOGLE_CLIENT_ID</b>: ${clientId ? '✅' : '❌'}</li>
            <li><b>GOOGLE_CLIENT_SECRET</b>: ${clientSecret ? '✅' : '❌'}</li>
            <li><b>APP_URL</b>: ${appUrl ? '✅' : '❌'}</li>
          </ul>
          <p style="font-size: 14px; color: #666;">อย่าลืมกด Redeploy หลังจากใส่ค่าแล้วด้วยนะครับ</p>
        </div>
      `);
    }

    const oauth2Client = getOAuth2Client();
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent"
    });
    console.log("Redirecting to Google Auth URL...");
    res.redirect(url);
  } catch (error: any) {
    console.error("OAuth Error Catch:", error);
    res.status(500).send("OAuth Error: " + error.message);
  }
});

// Callback route to show the Refresh Token page (The one in your image)
app.get("/api/auth/google/callback", async (req, res) => {
  const { code } = req.query;
  const oauth2Client = getOAuth2Client();
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      return res.send("Error: No refresh token received. Try removing the app from your Google account and try again.");
    }

    // This HTML matches the image you provided
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Google OAuth Success</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Inter', sans-serif; background-color: #f8fafc; }
          .token-container { word-break: break-all; }
        </style>
      </head>
      <body class="flex items-center justify-center min-h-screen p-4">
        <div class="bg-white rounded-[32px] shadow-xl shadow-slate-200/50 border border-slate-100 p-10 max-w-2xl w-full text-center">
          <div class="flex items-center justify-center gap-4 mb-8">
            <div class="bg-[#10b981] rounded-xl p-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </div>
            <h1 class="text-4xl font-extrabold text-slate-900">คัดลอก <span class="text-[#6366f1]">Refresh Token</span> ของคุณ</h1>
          </div>

          <p class="text-xl text-slate-600 mb-2">นำค่าด้านล่างนี้ไปใส่ใน Vercel Environment Variables ชื่อ</p>
          <p class="text-3xl font-black text-slate-900 mb-10">GOOGLE_REFRESH_TOKEN</p>

          <div class="relative bg-slate-50 rounded-2xl border-2 border-slate-100 p-8 mb-10 text-left group">
            <div id="tokenText" class="text-lg font-mono text-slate-700 break-all leading-relaxed pr-20">${refreshToken}</div>
            <button 
              onclick="copyToken()" 
              id="copyBtn"
              class="absolute top-6 right-6 bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-xl font-bold hover:bg-slate-50 transition-all shadow-sm active:scale-95"
            >
              คัดลอก
            </button>
          </div>

          <div class="bg-[#fff1f2] border border-[#ffe4e6] rounded-2xl p-6 mb-12">
            <p class="text-xl font-extrabold text-[#e11d48] leading-relaxed">
              ขั้นตอนสุดท้าย: เมื่อใส่ค่าใน Vercel แล้ว อย่าลืมกด <a href="#" class="underline decoration-2 underline-offset-4">Redeploy</a> เพื่อให้ระบบเริ่มทำงานนะครับ
            </p>
          </div>

          <p class="text-slate-400 text-sm italic mb-6 leading-relaxed max-w-lg mx-auto">
            หมายเหตุ: หากคุณต้องการให้แอปทำงานต่อทันทีโดยไม่ต้องปิดหน้าต่างนี้ ระบบได้ส่งสัญญาณไปยังแอปหลักแล้ว
          </p>

          <button onclick="window.close()" class="text-slate-400 font-bold hover:text-slate-600 transition-colors underline underline-offset-4">
            ปิดหน้าต่างนี้
          </button>
        </div>

        <script>
          function copyToken() {
            const token = document.getElementById('tokenText').innerText;
            navigator.clipboard.writeText(token).then(() => {
              const btn = document.getElementById('copyBtn');
              btn.innerText = 'คัดลอกแล้ว!';
              btn.classList.add('bg-emerald-50', 'text-emerald-600', 'border-emerald-200');
              setTimeout(() => {
                btn.innerText = 'คัดลอก';
                btn.classList.remove('bg-emerald-50', 'text-emerald-600', 'border-emerald-200');
              }, 2000);
            });
          }
        </script>
      </body>
      </html>
    `);
  } catch (error: any) {
    res.status(500).send("Auth Failed: " + error.message);
  }
});

// --- New Drive & AI Analysis Endpoints ---

// Check Google Drive connection status
app.get("/api/drive/status", (req, res) => {
  const hasClientId = !!process.env.GOOGLE_CLIENT_ID;
  const hasClientSecret = !!process.env.GOOGLE_CLIENT_SECRET;
  const hasRefreshToken = !!process.env.GOOGLE_REFRESH_TOKEN;
  
  res.json({
    connected: hasRefreshToken,
    configured: hasClientId && hasClientSecret,
    missing: {
      clientId: !hasClientId,
      clientSecret: !hasClientSecret,
      refreshToken: !hasRefreshToken
    }
  });
});

// List subfolders of a parent folder
app.get("/api/drive/subfolders/:parentFolderId", async (req: any, res: any) => {
  const { parentFolderId } = req.params;
  const driveService = getDriveService();
  if (!driveService) return res.status(500).json({ error: "Drive service not configured" });

  try {
    const response = await driveService.files.list({
      q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id, name)",
      orderBy: "name desc"
    });
    res.json(response.data.files || []);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List images in a folder and their analysis status
app.get("/api/drive/folder/:folderId/images", async (req: any, res: any) => {
  const { folderId } = req.params;
  const driveService = getDriveService();
  if (!driveService) return res.status(500).json({ error: "Drive service not configured" });

  try {
    // 1. Get images from Drive
    const driveResponse = await driveService.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: "files(id, name, mimeType, thumbnailLink, webViewLink)",
      pageSize: 1000
    });
    const images = driveResponse.data.files || [];

    // 2. Get analysis history from Google Sheets
    const history = await getAnalysisHistory();

    // 3. Merge status
    const mergedImages = images.map(img => {
      const analysis = history.find(h => h.fileId === img.id);
      return {
        ...img,
        analysis: analysis || null
      };
    });

    res.json(mergedImages);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Analyze a single image
app.post("/api/analyze-image", async (req: any, res: any) => {
  const { fileId, fileName, folderId, mimeType } = req.body;
  const driveService = getDriveService();
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในระบบ" });
  }
  if (!driveService) {
    return res.status(500).json({ error: "ยังไม่ได้เชื่อมต่อ Google Drive หรือขาด Refresh Token" });
  }

  try {
    // 0. Check history first to avoid re-analysis
    const history = await getAnalysisHistory();
    const existing = history.find(h => h.fileId === fileId);
    if (existing) {
      console.log(`Image ${fileName} already analyzed, returning cached result.`);
      return res.json(existing);
    }

    // 1. Download image
    console.time(`Download-${fileId}`);
    const response = await driveService.files.get({
      fileId,
      alt: 'media'
    }, { 
      responseType: 'arraybuffer',
      timeout: 60000 // 60s timeout for download
    });
    console.timeEnd(`Download-${fileId}`);
    
    const base64 = Buffer.from(response.data as any).toString('base64');
    console.log(`Image ${fileName} size: ${(response.data as any).byteLength / 1024 / 1024} MB`);

    // 2. Analyze with Gemini
    console.time(`Analysis-${fileId}`);
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `คุณคือผู้เชี่ยวชาญด้านความปลอดภัยและความสะอาดของสถานีไฟฟ้าแรงสูง (Power Substation)
กรุณาวิเคราะห์รูปภาพนี้เพื่อระบุหมวดหมู่ที่เหมาะสมที่สุด และทำการประเมินดัชนีสุขภาพ (Health Index Score) อย่างถูกต้องตามเกณฑ์ข้อกำหนดด้านล่างนี้:

1. หมวดหมู่ (category): จัดภาพเข้าสู่หนึ่งในหมวดหมู่เหล่านี้: 'Battery', 'Yard', 'Checklist', 'Roof', 'Fence', 'Security', หรือ 'Other'
2. เกณฑ์การให้คะแนน (score) และเงื่อนไขประเมินตามหมวดหมู่:

• **หัวข้อ Battery (แบตเตอรี่ - น้ำกลั่นและสภาพขั้วแบต):**
  - จากรูปภาพที่ถ่าย **ให้ตรวจวิเคราะห์ลูกแบตเตอรี่เพียงลูกเดียวที่เห็นได้ชัดเจนที่สุด 1 ลูกเท่านั้น ไม่ต้องวิเคราะห์ทุกลูก และไม่ต้องสรุปภาพรวมทุกลูก** โดยให้ระบุหมายเลขประจำตัวของลูกแบตเตอรี่ลูกที่ชัดที่สุดลูกนั้นให้ชัดเจน (เช่น ลูกที่ 5 หรือหมายเลขอื่นๆ ที่เห็นบนสติกเกอร์ตัวถัง)
  - เปรียบเทียบระดับของเหลวหรือน้ำกลั่นเฉพาะลูกที่เลือกนี้ กับเส้นระดับสูงสุด (MAX / Upper limit) และระดับต่ำสุด (MIN / Lower limit) บนตัวถังของลูกนั้น
  - **100 คะแนน:** ระดับน้ำกลั่นของลูกแบตเตอรี่ที่ถูกเลือก (ลูกที่เห็นชัดที่สุดเพียง 1 ลูก) อยู่ระหว่างช่วงขีด UPPER (MAX) และ LOWER (MIN) อย่างสมเหตุสมผลและชัดเจนพอดี ขั้วแบตเตอรี่ของลูกที่เลือกนี้สะอาดปราศจากคราบเกลือหรือคราบซัลเฟตสีขาว/ขาวฟ้า
  - **50 คะแนน:** ลูกแบตเตอรี่ที่ถูกเลือก (ลูกที่เห็นชัดที่สุดเพียง 1 ลูก) มีระดับน้ำกลั่นที่เริ่มต่ำเกินไปจนมาถึงระดับใต้กึ่งกลางลงไปหาขีดล่าง หรือระดับน้ำค่อนข้างต่ำแต่ยังไม่ต่ำกว่าขีด LOWER สภาพภาพเบลอ มืด หรือระยะไกลมากจนมองเห็นไม่ชัดว่าลูกใดชัดสุดหรือไม่เหมาะสมที่จะประเมินแยกชิ้น
  - **0 คะแนน:** ลูกแบตเตอรี่ที่ถูกเลือก (ลูกที่เห็นชัดที่สุดเพียง 1 ลูก) มีระดับน้ำกลั่นแห้งหรือต่ำกว่าขีดจำกัดล่าง (MIN/Lower Limit) หรือปรากฏว่าตัวกรอบถังของลูกชัดสุดนี้มีความเสียหายบกพร่อง (เช่น โครงบวม ร้าว แตก รั่วซึม หรือมีคราบซัลเฟตหนามากเกาะที่ขั้วแบตเตอรี่)

• **หัวข้อ Yard (ลานไกสถานีไฟฟ้า):**
  - **100 คะแนน:** พื้นลานกรวดไม่มีวัชพืช 100%, Bus bar สะอาดไม่มีเศษพลาสติก/สายสิญจน์/รังนก
  - **70 คะแนน:** พบวัชพืชเล็กน้อย หรือมีคราบน้ำมันที่พื้น
  - **30 คะแนน:** หญ้าสูงพ้นระดับหินกรวด หรือมีสิ่งแปลกปลอมใกล้ระยะ Flashover ของ Bus bar

• **หัวข้อ Checklist (กระดาษ Check list):**
  - **100 คะแนน:** ภาพถ่ายเห็นชัดว่าลงบันทึกครบทุกช่อง, มีลายเซ็นผู้ตรวจและผู้ควบคุมงาน, วันที่ตรงกับวันปัจจุบัน
  - **50 คะแนน:** ลงข้อมูลไม่ครบบางส่วน หรือลายมืออ่านยากมากจนอาจเกิดความเข้าใจผิด
  - **0 คะแนน:** ไม่มีการลงบันทึก, วันที่ย้อนหลัง หรือไม่มีภาพถ่าย Checklist

• **หัวข้อ Roof (ดาดฟ้าและความสะอาด):**
  - **100 คะแนน:** ปากท่อระบายน้ำสะอาด ไม่มีขี้นกสะสม หรือเศษวัสดุขวางทางน้ำ
  - **50 คะแนน:** มีขี้นกสะสมบ้างแต่ยังไม่ส่งกลิ่นหรืออุดตัน
  - **0 คะแนน:** ท่อระบายน้ำอุดตันชัดเจน หรือมีน้ำขังบนดาดฟ้า

• **หัวข้อ Fence (รอบรั้ว 4 ด้าน):**
  - **100 คะแนน:** ภาพครบ 4 ด้าน, รั้วไม่มีช่องโหว่, ประตูล็อคสนิท, ป้ายเตือนอันตรายชัดเจน
  - **50 คะแนน:** ขาดภาพบางด้าน หรือมีต้นไม้ขึ้นหนาจนมองไม่เห็นสภาพรั้ว
  - **0 คะแนน:** รั้วชำรุด หรือมีการบุกรุก/สัตว์ทำรังขนาดใหญ่

• **หัวข้อ Security (รปภ. การแต่งกาย):**
  - **100 คะแนน:** สวมเครื่องแบบตามระเบียบครบถ้วน รวมไปถึงอุปกรณ์ความปลอดภัย (ถ้ากำหนด)
  - **0 คะแนน:** แต่งกายไม่เรียบร้อย (เช่น สวมรองเท้าแตะ, ไม่ใส่เสื้อเครื่องแบบ) หรือไม่อยู่ในจุดปฏิบัติงาน

• **หัวข้อ Other (อื่นๆ):** ประเมินคะแนน 0-100 ตามความเหมาะสม

ในช่อง 'summary' ให้เขียนรายงานอธิบายการวิเคราะห์สภาพตามเกณฑ์ของประเด็นข้างต้นอย่างละเอียดเป็นภาษาไทย โดยมีความเฉพาะเจาะจงสูงมาก:
- หากวิเคราะห์ได้ว่าเป็น 'Battery' ต้องเขียนรายงานระบุให้ชัดเจนถึงระดับน้ำกลั่นของลูกแบตเตอรี่หมายเลขเดียวที่โดดเด่นและเห็นชัดเจนที่สุดเพียง 1 ลูกเท่านั้น เช่น "จากการตรวจสอบระบบแบตเตอรี่ OPzS โดยเลือกช่อง/ลูกแบตเตอรี่ที่บันทึกพิกัดเห็นภาพชัดที่สุด 1 ลูก คือ แบตเตอรี่หมายเลข 5 พบว่าระดับน้ำกลั่นอยู่ในเกณฑ์ปกติเหนือระดับ MIN และคงความปลอดภัยระหว่างขีด Upper และ Lower, ขั้วต่อสะอาดสวยงามปราศจากคราบเกลือ" (รายงานเจาะลึกเฉพาะลูกที่เห็นชัดเจนที่สุดเพียงลูกเดียว 1 ลูกเท่านั้น ไม่รายงานภาพรวมหรือทุกลูกรวมกัน)
- หากเป็นหัวข้ออื่นๆ ก็ให้ระบุลักษณะเฉพาะที่สแกนเจอและประเมินเป็นภาษาไทยอย่างละเอียดเช่นกัน

ตอบกลับในรูปแบบ JSON เท่านั้น โดยมีโครงสร้างดังนี้:
{
  "status": "Green" (เมื่อไม่มีข้อชำรุดบกพร่องตามเกณฑ์คะแนนต่ำ เช่น ประเมินได้คะแนนเต็ม) หรือ "Red" (เมื่อได้คะแนนต่ำ หรือมีสิ่งบกพร่องสำคัญอย่างเห็นได้ชัด),
  "findings": ["Weed", "Bird Droppings", "Low Water Level", "Dirty Terminals", ...], (ระบุคำหลักข้อขัดข้องที่ตรวจพบ),
  "summary": "สรุปรายงานผลการวิเคราะห์อย่างละเอียดเป็นภาษาไทย โดยสำหรับหัวข้อ Battery ให้รายงานผลวิเคราะห์เฉพาะลูกแบตเตอรี่ที่มองเห็นชัดเจนที่สุดเพียง 1 ลูกเท่านั้นพร้อมระบุหมายเลขลูกให้ชัดเจน",
  "category": "Battery" | "Yard" | "Checklist" | "Roof" | "Fence" | "Security" | "Other",
  "score": 100
}`;

    // Add a timeout to Gemini call to prevent hanging
    const analysisPromise = generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: [
        { 
          parts: [
            { text: prompt }, 
            { inlineData: { data: base64, mimeType: mimeType || 'image/jpeg' } }
          ] 
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            status: { type: Type.STRING },
            findings: { type: Type.ARRAY, items: { type: Type.STRING } },
            summary: { type: Type.STRING },
            category: { type: Type.STRING },
            score: { type: Type.INTEGER }
          },
          required: ["status", "findings", "summary", "category", "score"]
        }
      }
    });

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Gemini API Timeout (120s)")), 120000)
    );

    const genResult = await Promise.race([analysisPromise, timeoutPromise]) as any;

    const analysisResult = JSON.parse(genResult.text || '{}');
    console.timeEnd(`Analysis-${fileId}`);
    const finalResult = {
      fileId,
      fileName,
      folderId,
      ...analysisResult
    };

    // 3. Save to Google Sheets (Non-blocking or with its own catch)
    try {
      await saveAnalysisResult(finalResult);
      
      // Update cache if it exists
      if (historyCache) {
        historyCache.data.push({
          fileId: finalResult.fileId,
          fileName: finalResult.fileName,
          folderId: finalResult.folderId,
          status: finalResult.status,
          findings: finalResult.findings,
          summary: finalResult.summary,
          analyzedAt: new Date().toISOString()
        });
      }
    } catch (sheetError) {
      console.error("Failed to save to Google Sheets, but returning analysis:", sheetError);
    }

    res.json(finalResult);
  } catch (error: any) {
    console.error("Analysis error:", error);
    res.status(500).json({ error: error.message });
  }
});

let drive: any = null;
let sheets: any = null;

let cachedOAuth2Client: any = null;
let lastRefreshToken: string | null = null;

function getGoogleAuth() {
  // Priority 1: OAuth2 Refresh Token (User account has storage quota)
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (refreshToken) {
    if (cachedOAuth2Client && lastRefreshToken === refreshToken) {
      return cachedOAuth2Client;
    }
    
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    cachedOAuth2Client = oauth2Client;
    lastRefreshToken = refreshToken;
    return oauth2Client;
  }

  // Priority 2: Service Account (Fallback)
  const authJson = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (authJson) {
    try {
      const credentials = JSON.parse(authJson);
      return new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: SCOPES
      });
    } catch (err) {
      console.error("Failed to initialize Service Account Auth:", err);
    }
  }

  return null;
}

function getDriveService() {
  const auth = getGoogleAuth();
  if (!auth) return null;
  return google.drive({ version: "v3", auth });
}

function getSheetsService() {
  const auth = getGoogleAuth();
  if (!auth) return null;
  return google.sheets({ version: "v4", auth });
}

app.use(express.json());

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "SSVI API is running" });
});

// 1. Initialize Upload: Create folders and return Access Token
app.post("/api/init-upload", async (req: any, res: any) => {
  const { substationName, timestamp } = req.body;
  
  // Simple lock to prevent concurrent creation of the same folder
  const lockKey = `${substationName}-${timestamp?.split('T')[0]}`;
  if (folderCreationLocks.has(lockKey)) {
    // Wait a bit and retry search instead of creating
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  folderCreationLocks.add(lockKey);

  const driveService = getDriveService();
  const auth = getGoogleAuth();
  const pool = getDbPool();

  if (!driveService || !auth) {
    return res.status(500).json({ error: "Google Drive service not configured" });
  }

  try {
    // Get fresh access token
    const tokenResponse = await auth.getAccessToken();
    const accessToken = tokenResponse.token;

    if (!accessToken) {
      console.error("Access token is empty");
      return res.status(500).json({ error: "Failed to generate Google Access Token. Please check your Refresh Token." });
    }

    const dateObj = timestamp ? new Date(timestamp) : new Date();
    const dateStr = new Intl.DateTimeFormat("th-TH", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      timeZone: "Asia/Bangkok"
    }).format(dateObj).replace(/\//g, ""); 
    
    const parentFolderId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "1IzXUWJfucyb47Dr32QSVIxBKmoMrWF6J";

    // 1. Find or Create Main Substation Folder (Use DB for consistency)
    let mainFolderId;
    if (pool) {
      const dbResult = await pool.query("SELECT folder_id FROM substation_master_folders WHERE substation_name = $1", [substationName]);
      if (dbResult.rows.length > 0) {
        mainFolderId = dbResult.rows[0].folder_id;
      }
    }

    if (!mainFolderId) {
      // Double check Drive just in case
      const mainFolderQuery = await driveService.files.list({
        q: `name = '${substationName}' and mimeType = 'application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed = false`,
        fields: "files(id)",
      });

      if (mainFolderQuery.data.files && mainFolderQuery.data.files.length > 0) {
        mainFolderId = mainFolderQuery.data.files[0].id;
      } else {
        const folder = await driveService.files.create({
          requestBody: {
            name: substationName,
            mimeType: "application/vnd.google-apps.folder",
            parents: [parentFolderId],
          },
          fields: "id",
        });
        mainFolderId = folder.data.id;
      }

      // Store in DB
      if (pool && mainFolderId) {
        try {
          await pool.query(
            "INSERT INTO substation_master_folders (substation_name, folder_id) VALUES ($1, $2) ON CONFLICT (substation_name) DO UPDATE SET folder_id = EXCLUDED.folder_id",
            [substationName, mainFolderId]
          );
        } catch (dbErr) {
          console.error("Failed to store master folder in DB:", dbErr);
        }
      }
    }

    // 2. Find or Create Daily Folder
    const dailyFolderName = `${substationName}_${dateStr}`;
    let dailyFolderId;
    const dailyFolderQuery = await driveService.files.list({
      q: `name = '${dailyFolderName}' and mimeType = 'application/vnd.google-apps.folder' and '${mainFolderId}' in parents and trashed = false`,
      fields: "files(id)",
    });

    if (dailyFolderQuery.data.files && dailyFolderQuery.data.files.length > 0) {
      dailyFolderId = dailyFolderQuery.data.files[0].id;
    } else {
      const folder = await driveService.files.create({
        requestBody: {
          name: dailyFolderName,
          mimeType: "application/vnd.google-apps.folder",
          parents: [mainFolderId],
        },
        fields: "id",
      });
      dailyFolderId = folder.data.id;
    }

    res.json({ 
      accessToken, 
      folderId: dailyFolderId 
    });
  } catch (error: any) {
    console.error("Init upload error:", error);
    res.status(500).json({ error: error.message });
  } finally {
    folderCreationLocks.delete(lockKey);
  }
});

// 2. Complete Upload: Log to DB and Sheets
app.post("/api/complete-upload", async (req: any, res: any) => {
  const { employeeId, substationName, lat, lng, timestamp, folderId, categories } = req.body;
  
  try {
    const dateObj = timestamp ? new Date(timestamp) : new Date();
    
    // Log to Database
    const pool = getDbPool();
    if (pool) {
      try {
        await pool.query(
          "INSERT INTO inspection_logs (employee_id, substation_name, gps_lat, gps_lng, folder_id, timestamp) VALUES ($1, $2, $3, $4, $5, $6)",
          [employeeId || "Unknown", substationName, lat, lng, folderId, dateObj]
        );
      } catch (dbErr) {
        console.error("DB Log failed:", dbErr);
      }
    }

    // Log to Google Sheets
    const sheetsService = getSheetsService();
    const sheetId = process.env.GOOGLE_SHEET_ID || "1WpvuQnhXzufiBmSRSaEnkRFs9BJf5H4fIWZ0xoYC8iw";
    if (sheetsService && sheetId) {
      try {
        const options: Intl.DateTimeFormatOptions = { 
          timeZone: "Asia/Bangkok",
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
          hour12: false 
        };
        const dateTimeStr = new Intl.DateTimeFormat("th-TH", options).format(dateObj);

        const REQUIRED_CATEGORIES = ['building', 'yard', 'roof', 'annunciation', 'battery', 'grounding', 'security', 'fence', 'lighting', 'checklist'];
        const categoryChecks = REQUIRED_CATEGORIES.map(cat => categories.split(',').includes(cat) ? "1" : "0");

        const rowData = [
          dateTimeStr,
          (employeeId && String(employeeId).trim()) ? String(employeeId).trim() : "ไม่ระบุ",
          substationName || "ไม่ระบุ",
          lat || "0",
          lng || "0",
          `https://drive.google.com/drive/folders/${folderId}`,
          "Completed",
          ...categoryChecks
        ];

        await sheetsService.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: "A:Q",
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [rowData] }
        });
      } catch (sheetErr) {
        console.error("Failed to log to Google Sheets:", sheetErr);
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/upload-inspection", upload.array("photos"), async (req: any, res: any) => {
  const { employeeId, substationName, lat, lng, timestamp } = req.body;
  
  // Deduplication check
  const submissionKey = `${employeeId}-${substationName}`;
  const now = Date.now();
  if (recentSubmissions.has(submissionKey)) {
    const lastTime = recentSubmissions.get(submissionKey)!;
    if (now - lastTime < 10000) { // 10 seconds window
      console.log(`Duplicate submission detected for ${submissionKey}, ignoring...`);
      return res.json({ success: true, message: "Duplicate request ignored" });
    }
  }
  recentSubmissions.set(submissionKey, now);
  
  // Debug log to see what's coming in
  console.log("New Inspection Submission:");
  console.log("- Employee ID:", employeeId);
  console.log("- Substation:", substationName);
  console.log("- Timestamp:", timestamp);

  const files = req.files as any[];
  const driveService = getDriveService();

  if (!driveService) {
    console.error("Google Drive Service is NULL");
    return res.status(500).json({ error: "Google Drive service not configured" });
  }

  try {
    // Ensure we have a valid date in Thailand timezone
    const dateObj = timestamp ? new Date(timestamp) : new Date();
    
    // Format for folder naming (DDMMYY)
    const dateStr = new Intl.DateTimeFormat("th-TH", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      timeZone: "Asia/Bangkok"
    }).format(dateObj).replace(/\//g, ""); 
    
    const parentFolderId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "1IzXUWJfucyb47Dr32QSVIxBKmoMrWF6J";

    // 1. Find or Create Main Substation Folder (e.g., "สถานีไฟฟ้านครชัยศรี 1")
    let mainFolderId;
    const mainFolderQuery = await driveService.files.list({
      q: `name = '${substationName}' and mimeType = 'application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed = false`,
      fields: "files(id)",
    });

    if (mainFolderQuery.data.files && mainFolderQuery.data.files.length > 0) {
      mainFolderId = mainFolderQuery.data.files[0].id;
    } else {
      const folderMetadata = {
        name: substationName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentFolderId],
      };
      const folder = await driveService.files.create({
        requestBody: folderMetadata,
        fields: "id",
      });
      mainFolderId = folder.data.id;
    }

    // 2. Find or Create Daily Folder (e.g., "สถานีไฟฟ้านครชัยศรี 1_260269") inside Main Folder
    const dailyFolderName = `${substationName}_${dateStr}`;
    let dailyFolderId;
    const dailyFolderQuery = await driveService.files.list({
      q: `name = '${dailyFolderName}' and mimeType = 'application/vnd.google-apps.folder' and '${mainFolderId}' in parents and trashed = false`,
      fields: "files(id)",
    });

    if (dailyFolderQuery.data.files && dailyFolderQuery.data.files.length > 0) {
      dailyFolderId = dailyFolderQuery.data.files[0].id;
    } else {
      const folderMetadata = {
        name: dailyFolderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [mainFolderId],
      };
      const folder = await driveService.files.create({
        requestBody: folderMetadata,
        fields: "id",
      });
      dailyFolderId = folder.data.id;
    }

    // 3. Upload Files to Daily Folder
    const categoriesFromFiles = new Set<string>();
    for (const file of files) {
      const category = file.originalname.split('_')[0];
      if (category) categoriesFromFiles.add(category);

      const fileMetadata = {
        name: file.originalname,
        parents: [dailyFolderId],
      };
      const media = {
        mimeType: file.mimetype,
        body: Readable.from(file.buffer),
      };
      await driveService.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id",
      });
    }

    // Use categories from body if provided, otherwise fallback to filename parsing
    const categoriesStr = req.body.categories || Array.from(categoriesFromFiles).join(',');

    // 3. Log to Database
    const pool = getDbPool();
    if (pool) {
      try {
        await pool.query(
          "INSERT INTO inspection_logs (employee_id, substation_name, gps_lat, gps_lng, folder_id, timestamp) VALUES ($1, $2, $3, $4, $5, $6)",
          [employeeId || "Unknown", substationName, lat, lng, dailyFolderId, dateObj]
        );
      } catch (dbErr) {
        console.error("DB Log failed:", dbErr);
      }
    }

    // 4. Log to Google Sheets
    const sheetsService = getSheetsService();
    const sheetId = process.env.GOOGLE_SHEET_ID || "1WpvuQnhXzufiBmSRSaEnkRFs9BJf5H4fIWZ0xoYC8iw";
    if (sheetsService && sheetId) {
      try {
        // Format date/time explicitly for Google Sheets in Thailand timezone
        const options: Intl.DateTimeFormatOptions = { 
          timeZone: "Asia/Bangkok",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false 
        };
        
        const formatter = new Intl.DateTimeFormat("th-TH", options);
        const dateTimeStr = formatter.format(dateObj);

        const REQUIRED_CATEGORIES = ['building', 'yard', 'roof', 'annunciation', 'battery', 'grounding', 'security', 'fence', 'lighting', 'checklist'];
        const categoryChecks = REQUIRED_CATEGORIES.map(cat => categoriesStr.split(',').includes(cat) ? "1" : "0");

        const rowData = [
          dateTimeStr,
          (employeeId && String(employeeId).trim()) ? String(employeeId).trim() : "ไม่ระบุ",
          substationName || "ไม่ระบุ",
          lat || "0",
          lng || "0",
          `https://drive.google.com/drive/folders/${dailyFolderId}`,
          "Completed",
          ...categoryChecks
        ];
        
        console.log("Final Row Data for Sheets:", rowData);

        await sheetsService.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: "A:Q", // Updated range for 17 columns (A to Q)
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [rowData]
          }
        });
        console.log("Successfully appended to Google Sheets");
      } catch (sheetErr) {
        console.error("Failed to log to Google Sheets:", sheetErr);
      }
    }

    res.json({ success: true, folderId: dailyFolderId });
  } catch (error: any) {
    console.error("Upload error:", error);
    
    let errorMessage = error.message;
    if (errorMessage.includes("invalid_grant")) {
      errorMessage = "สิทธิ์การเข้าถึง Google Drive หมดอายุ (invalid_grant) กรุณาแจ้งผู้ดูแลระบบให้ทำการต่ออายุ Token ใหม่ที่เมนูตั้งค่า";
    } else if (errorMessage.includes("insufficient_permissions")) {
      errorMessage = "ไม่มีสิทธิ์เข้าถึงโฟลเดอร์ Google Drive กรุณาตรวจสอบการตั้งค่าสิทธิ์";
    }
    
    res.status(500).json({ error: errorMessage });
  }
});

app.get("/api/dashboard-stats", async (req, res) => {
  const { month, year } = req.query;
  const sheetsService = getSheetsService();
  const sheetId = process.env.GOOGLE_SHEET_ID || "1WpvuQnhXzufiBmSRSaEnkRFs9BJf5H4fIWZ0xoYC8iw";

  if (!sheetsService) {
    return res.json({ total: 0, recent: [], error: "ยังไม่ได้เชื่อมต่อ Google Sheets หรือขาด Refresh Token" });
  }
  if (!sheetId) {
    return res.json({ total: 0, recent: [], error: "ยังไม่ได้ตั้งค่า GOOGLE_SHEET_ID ในระบบ" });
  }

  try {
    const response = await sheetsService.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "A2:Q", // Fetch all columns including categories (A to Q)
    });

    const rows = response.data.values || [];
    const targetMonth = parseInt(month as string);
    const targetYear = parseInt(year as string);

    const filteredLogs = rows.map((row, index) => {
      // Row structure: [Timestamp, EmployeeID, SubstationName, Lat, Lng, FolderURL, Status]
      const dateStr = (row[0] || "").toString().trim();
      if (!dateStr) return null;

      // Robust parsing for dates like "03/03/2569 21:38:00" or "03/03/26 21:38"
      const parts = dateStr.split(/[\s/:]+/);
      if (parts.length < 3) return null;
      
      const day = parseInt(parts[0]);
      const monthIdx = parseInt(parts[1]) - 1;
      let yearVal = parseInt(parts[2]);

      if (yearVal < 100) {
        // Handle 2-digit years
        if (yearVal > 50) yearVal += 2500;
        else yearVal += 2000;
      }
      if (yearVal > 2500) yearVal -= 543;

      const hour = parseInt(parts[3]) || 0;
      const minute = parseInt(parts[4]) || 0;
      const second = parseInt(parts[5]) || 0;

      // Construct ISO string with +07:00 offset
      const isoStr = `${yearVal}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}+07:00`;
      const logDate = new Date(isoStr);
      
      if (isNaN(logDate.getTime())) return null;
      
      // Check if it matches the filter
      if (targetMonth && targetYear) {
        if (logDate.getMonth() + 1 !== targetMonth || logDate.getFullYear() !== targetYear) {
          return null;
        }
      }

      const folderUrl = row[5] || "";
      const folderId = folderUrl.split("/").pop() || "";

      const REQUIRED_CATEGORIES = ['building', 'yard', 'roof', 'annunciation', 'battery', 'grounding', 'security', 'fence', 'lighting', 'checklist'];
      
      // Extract categories - handle old (comma-separated), checkmarks, and new (1/0) formats
      let categories: string[] = [];
      const colH = (row[7] || "").toString().trim();
      
      // Check for 1/0 or checkmarks in columns H through Q (indices 7 to 16)
      const hasNewFormat = row.slice(7, 17).some(val => {
        const v = val ? val.toString().trim() : "";
        return v === "1" || v === "0" || v === "✓" || v === "✔";
      });
      
      if (hasNewFormat) {
        REQUIRED_CATEGORIES.forEach((cat, i) => {
          const cellVal = (row[7 + i] || "").toString().trim();
          if (cellVal === "1" || cellVal === "✓" || cellVal === "✔") {
            categories.push(cat);
          }
        });
      } else if (colH.includes(',')) {
        // Fallback to old comma-separated format
        categories = colH.split(',').map(s => s.trim()).filter(Boolean);
      } else if (colH) {
        // Single category or old format with 1 item
        const possibleCat = colH.toLowerCase();
        if (REQUIRED_CATEGORIES.includes(possibleCat)) {
          categories.push(possibleCat);
        }
      }

      const logEntry = {
        id: index,
        employee_id: row[1] || "Unknown",
        substation_name: (row[2] || "").trim() || "Unknown",
        timestamp: logDate.toISOString(),
        gps_lat: parseFloat(row[3]) || 0,
        gps_lng: parseFloat(row[4]) || 0,
        folder_id: folderId,
        status: row[6] || "completed",
        categories: categories
      };
      return logEntry;
    }).filter(log => log !== null) as any[];

    // Sort by timestamp descending
    filteredLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Count unique substations that are "Complete"
    // A substation is complete if it has the 3 mandatory categories covered in the month
    const MANDATORY_CATEGORIES = ['fence', 'battery', 'checklist'];
    
    const substationCompletion = new Map<string, Set<string>>();
    filteredLogs.forEach(log => {
      const name = (log.substation_name || "").trim();
      if (!substationCompletion.has(name)) {
        substationCompletion.set(name, new Set());
      }
      (log.categories || []).forEach((cat: string) => {
        if (MANDATORY_CATEGORIES.includes(cat)) {
          substationCompletion.get(name)?.add(cat);
        }
      });
    });

    let completedCount = 0;
    substationCompletion.forEach((cats) => {
      if (cats.size >= MANDATORY_CATEGORIES.length) {
        completedCount++;
      }
    });

    res.json({
      total: completedCount,
      totalSubmissions: filteredLogs.length,
      recent: filteredLogs,
    });
  } catch (error: any) {
    console.error("Dashboard stats error (Sheets):", error);
    let errorMessage = error.message;
    if (errorMessage.includes("invalid_grant")) {
      errorMessage = "สิทธิ์การเข้าถึง Google Sheets หมดอายุ (invalid_grant) กรุณาแจ้งผู้ดูแลระบบให้ทำการต่ออายุ Token ใหม่";
    }
    res.status(500).json({ error: "Failed to fetch stats: " + errorMessage });
  }
});

// AI Analysis Endpoint
app.post("/api/analyze-substation", async (req: any, res: any) => {
  const { substationName, month, year, dryRun, force } = req.body;
  const driveService = getDriveService();
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในระบบ" });
  }
  if (!driveService) {
    return res.status(500).json({ error: "ยังไม่ได้เชื่อมต่อ Google Drive หรือขาด Refresh Token (กรุณาไปที่หน้าตั้งค่าเพื่อเชื่อมต่อใหม่)" });
  }

  try {
    // Check if already analyzed in Google Sheets first, then DB to avoid redundant calls if not forced
    if (!force && !dryRun) {
      try {
        const list = await getHealthIndexFromSheet();
        const existing = list.find(h => h.substation_name === substationName && h.month === parseInt(month) && h.year === parseInt(year));
        if (existing) {
          console.log(`Substation ${substationName} already analyzed in Google Sheet, returning existing result.`);
          return res.json(existing);
        }
      } catch (sheetErr) {
        console.error("Failed to read from Google Sheet during check:", sheetErr);
      }

      const pool = getDbPool();
      if (pool) {
        const existing = await pool.query(
          "SELECT * FROM health_index_logs WHERE substation_name = $1 AND month = $2 AND year = $3",
          [substationName, month, year]
        );
        if (existing.rows.length > 0) {
          console.log(`Substation ${substationName} already analyzed in DB, returning existing result.`);
          return res.json(existing.rows[0]);
        }
      }
    }
    const parentFolderId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "1IzXUWJfucyb47Dr32QSVIxBKmoMrWF6J";
    
    // 0. Verify Parent Folder Access
    try {
      await driveService.files.get({ fileId: parentFolderId, fields: "id, name" });
    } catch (err: any) {
      console.error("Parent folder access error:", err);
      return res.status(400).json({ error: `ไม่สามารถเข้าถึงโฟลเดอร์หลักได้ (ID: ${parentFolderId}) กรุณาตรวจสอบสิทธิ์การเข้าถึงหรือ ID โฟลเดอร์` });
    }
    console.log(`Searching for substation folder: ${substationName} in parent: ${parentFolderId}`);
    const mainFolderQuery = await driveService.files.list({
      q: `name contains '${substationName}' and mimeType = 'application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed = false`,
      fields: "files(id, name)",
      pageSize: 1000
    });

    if (!mainFolderQuery.data.files || mainFolderQuery.data.files.length === 0) {
      console.log(`Substation folder not found for: ${substationName}`);
      return res.status(404).json({ error: `ไม่พบโฟลเดอร์สถานี "${substationName}" ใน Google Drive กรุณาตรวจสอบชื่อโฟลเดอร์` });
    }
    
    // Find the best match (exact or closest)
    const bestMatch = mainFolderQuery.data.files.find(f => f.name === substationName) || mainFolderQuery.data.files[0];
    const mainFolderId = bestMatch.id;
    console.log(`Found main folder: ${bestMatch.name} (${mainFolderId})`);

    // 2. List all subfolders (daily folders)
    const subfoldersQuery = await driveService.files.list({
      q: `'${mainFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id, name)",
      pageSize: 1000
    });

    const subfolders = subfoldersQuery.data.files || [];
    
    // 3. Filter subfolders for the requested month/year
    // Support multiple formats: DDMMYY, DDMMYYYY, or just MMYY/MMYYYY
    const ceYearShort = String(year).slice(-2);
    const ceYearFull = String(year);
    const beYearShort = String(year + 543).slice(-2);
    const beYearFull = String(year + 543);
    const mm = String(month).padStart(2, '0');
    
    const patterns = [
      `${mm}${ceYearShort}`,
      `${mm}${ceYearFull}`,
      `${mm}${beYearShort}`,
      `${mm}${beYearFull}`
    ];
    
    console.log(`Searching for folders containing patterns: ${patterns.join(', ')}`);
    const matchingFolders = subfolders.filter(f => {
      const name = f.name || "";
      return patterns.some(p => name.includes(p));
    });

    if (matchingFolders.length === 0) {
      const noDataResult = { 
        status: 'Green', 
        findings: [], 
        summary: `ไม่พบข้อมูลการถ่ายภาพของเดือน ${month}/${year}`,
        folderId: null
      };
      
      // Save "No Data" state to Google Sheets so it shows up
      try {
        await saveHealthIndexToSheet({
          substationName, month, year,
          status: noDataResult.status,
          findings: noDataResult.findings,
          summary: noDataResult.summary
        });
      } catch (sheetErr) {
        console.error("Failed to save 'No Data' to Google Sheets:", sheetErr);
      }

      // Save "No Data" state to DB so it shows up
      const pool = getDbPool();
      if (pool) {
        await pool.query(
          `INSERT INTO health_index_logs (substation_name, month, year, status, findings, summary)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (substation_name, month, year) 
           DO UPDATE SET status = EXCLUDED.status, findings = EXCLUDED.findings, summary = EXCLUDED.summary, analyzed_at = CURRENT_TIMESTAMP`,
          [substationName, month, year, noDataResult.status, noDataResult.findings, noDataResult.summary]
        );
      }
      
      return res.json(noDataResult);
    }

    const folderId = matchingFolders[0].id;

    if (dryRun) {
      return res.json({ folderId });
    }

    // 4. Collect all images from matching folders
    const allImages: any[] = [];
    console.log(`Found ${matchingFolders.length} matching folders.`);
    for (const folder of matchingFolders) {
      const filesQuery = await driveService.files.list({
        q: `'${folder.id}' in parents and mimeType contains 'image/' and trashed = false`,
        fields: "files(id, name, mimeType)",
        pageSize: 1000 // Get all images in the folder
      });
      if (filesQuery.data.files) {
        console.log(`Folder ${folder.name} has ${filesQuery.data.files.length} images.`);
        allImages.push(...filesQuery.data.files);
      }
    }
    console.log(`Total images to analyze: ${allImages.length}`);

    if (allImages.length === 0) {
      const noImageResult = { 
        status: 'Green', 
        findings: [], 
        summary: `ไม่พบรูปภาพในเดือน ${month}/${year}` 
      };
      
      // Save "No Image" state to Google Sheets so it shows up
      try {
        await saveHealthIndexToSheet({
          substationName, month, year,
          status: noImageResult.status,
          findings: noImageResult.findings,
          summary: noImageResult.summary
        });
      } catch (sheetErr) {
        console.error("Failed to save 'No Image' to Google Sheets:", sheetErr);
      }

      const pool = getDbPool();
      if (pool) {
        await pool.query(
          `INSERT INTO health_index_logs (substation_name, month, year, status, findings, summary)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (substation_name, month, year) 
           DO UPDATE SET status = EXCLUDED.status, findings = EXCLUDED.findings, summary = EXCLUDED.summary, analyzed_at = CURRENT_TIMESTAMP`,
          [substationName, month, year, noImageResult.status, noImageResult.findings, noImageResult.summary]
        );
      }
      
      return res.json(noImageResult);
    }

    // 5. Download images and analyze them in parallel with a limit
    const individualResults: any[] = [];
    const history = await getAnalysisHistory();
    
    // Process in chunks of 5 to avoid rate limits and timeouts while being faster than sequential
    const CHUNK_SIZE = 5;
    for (let i = 0; i < allImages.length; i += CHUNK_SIZE) {
      const chunk = allImages.slice(i, i + CHUNK_SIZE);
      console.log(`Analyzing chunk ${Math.floor(i/CHUNK_SIZE) + 1}/${Math.ceil(allImages.length/CHUNK_SIZE)} (${chunk.length} images)...`);
      
      const chunkPromises = chunk.map(async (img) => {
        try {
          // Check if already analyzed in history (only if not forced)
          if (!force) {
            const existing = history.find(h => h.fileId === img.id);
            if (existing) {
              console.log(`Image ${img.name} already analyzed, using cached result.`);
              return existing;
            }
          }

          console.log(`Downloading image: ${img.name} (${img.id})...`);
          const response = await driveService.files.get({
            fileId: img.id,
            alt: 'media'
          }, { 
            responseType: 'arraybuffer',
            timeout: 90000 // Increase to 90s
          });
          
          const base64 = Buffer.from(response.data as any).toString('base64');
          
          // Analyze this single image
          const ai = new GoogleGenAI({ apiKey });
          const prompt = `คุณคือผู้เชี่ยวชาญด้านความปลอดภัยและความสะอาดของสถานีไฟฟ้าแรงสูง (Power Substation)
กรุณาวิเคราะห์รูปภาพนี้เพื่อระบุหมวดหมู่ที่เหมาะสมที่สุด และทำการประเมินดัชนีสุขภาพ (Health Index Score) อย่างถูกต้องตามเกณฑ์ข้อกำหนดด้านล่างนี้:

1. หมวดหมู่ (category): จัดภาพเข้าสู่หนึ่งในหมวดหมู่เหล่านี้: 'Battery', 'Yard', 'Checklist', 'Roof', 'Fence', 'Security', หรือ 'Other'
2. เกณฑ์การให้คะแนน (score) และเงื่อนไขประเมินตามหมวดหมู่:

• **หัวข้อ Battery (แบตเตอรี่ - น้ำกลั่นและสภาพขั้วแบต):**
  - จากรูปภาพ **ให้คัดเลือกวิเคราะห์ลูกแบตเตอรี่เพียงลูกเดียวที่เห็นได้ชัดเจนที่สุด 1 ลูกเท่านั้น ไม่ต้องวิเคราะห์ทุกลูก** โดยระบุหมายเลขประจำตัวของลูกแบตเตอรี่ที่เห็นพิกัดชัดสุดลูกนั้น (เช่น แบตเตอรี่หมายเลข 5)
  - **100 คะแนน:** ระดับน้ำกลั่นของลูกแบตเตอรี่ที่เลือกวิเคราะห์ (ลูกที่ชัดเจนที่สุดเพียง 1 ลูก) อยู่ระหว่างช่วงขีด Upper และ Lower เหมาะสมชัดเจน ขั้วแบตปราศจากพบคราบเกลือ/คราบซัลเฟต
  - **50 คะแนน:** ลูกแบตเตอรี่ที่เลือกวิเคราะห์ (ลูกที่ชัดเจนที่สุดเพียง 1 ลูก) มีระดับน้ำเริ่มต่ำเกินกึ่งกลางลงไปหาขีดล่างแต่ยังไม่ต่ำกว่า LOWER หรือกรณีแนวภาพเบลอจัดจนระบุพิกัดหรือระดับอย่างเจาะจงได้ยาก
  - **0 คะแนน:** ลูกแบตเตอรี่ที่เลือกวิเคราะห์ (ลูกที่ชัดเจนที่สุดเพียง 1 ลูก) พกระดับน้ำกลั่นแห้งเกลี้ยงหลุดขีดล่าง หรือพบลักษณะโครงถังของลูกที่ชัดสุดนั้น บวม แตก ร้าว รั่วซึม หรือขั้วมีเกลือซัลเฟตสะสมหนาเตอะ

• **หัวข้อ Yard (ลานไกสถานีไฟฟ้า):**
  - **100 คะแนน:** พื้นลานกรวดไม่มีวัชพืช 100%, Bus bar สะอาดไม่มีเศษพลาสติก/สายสิญจน์/รังนก
  - **70 คะแนน:** พบวัชพืชเล็กน้อย หรือมีคราบน้ำมันที่พื้น
  - **30 คะแนน:** หญ้าสูงพ้นระดับหินกรวด หรือมีสิ่งแปลกปลอมใกล้ระยะ Flashover ของ Bus bar

• **หัวข้อ Checklist (กระดาษ Check list):**
  - **100 คะแนน:** ภาพถ่ายเห็นชัดว่าลงบันทึกครบทุกช่อง, มีลายเซ็นผู้ตรวจและผู้ควบคุมงาน, วันที่ตรงกับวันปัจจุบัน
  - **50 คะแนน:** ลงข้อมูลไม่ครบบางส่วน หรือลายมืออ่านยากมากจนอาจเกิดความเข้าใจผิด
  - **0 คะแนน:** ไม่มีการลงบันทึก, วันที่ย้อนหลัง หรือไม่มีภาพถ่าย Checklist

• **หัวข้อ Roof (ดาดฟ้าและความสะอาด):**
  - **100 คะแนน:** ปากท่อระบายน้ำสะอาด ไม่มีขี้นกสะสม หรือเศษวัสดุขวางทางน้ำ
  - **50 คะแนน:** มีขี้นกสะสมบ้างแต่ยังไม่ส่งกลิ่นหรืออุดตัน
  - **0 คะแนน:** ท่อระบายน้ำอุดตันชัดเจน หรือมีน้ำขังบนดาดฟ้า

• **หัวข้อ Fence (รอบรั้ว 4 ด้าน):**
  - **100 คะแนน:** ภาพครบ 4 ด้าน, รั้วไม่มีช่องโหว่, ประตูล็อคสนิท, ป้ายเตือนอันตรายชัดเจน
  - **50 คะแนน:** ขาดภาพบางด้าน หรือมีต้นไม้ขึ้นหนาจนมองไม่เห็นสภาพรั้ว
  - **0 คะแนน:** รั้วชำรุด หรือมีการบุกรุก/สัตว์ทำรังขนาดใหญ่

• **หัวข้อ Security (รปภ. การแต่งกาย):**
  - **100 คะแนน:** สวมเครื่องแบบตามระเบียบครบถ้วน รวมไปถึงอุปกรณ์ความปลอดภัย (ถ้ากำหนด)
  - **0 คะแนน:** แต่งกายไม่เรียบร้อย (เช่น สวมรองเท้าแตะ, ไม่ใส่เสื้อเครื่องแบบ) หรือไม่อยู่ในจุดปฏิบัติงาน

• **หัวข้อ Other (อื่นๆ):** ประเมินคะแนน 0-100 ตามความเหมาะสม

In the 'summary' field, provide a detailed analysis in Thai about what was surveyed and evaluated referring to the audit criteria. (สำคัญมาก: หากหมวดหมู่คือ Battery ให้รายงานสรุปถึงพิกัดระดับน้ำกลั่นและสถานะขั้วต่อเฉพาะท่อหรือลูกที่ชัดเจนที่สุดเพียง 1 ลูกเท่านั้น ไม่ต้องวิเคราะห์ทุกลูกหรือสรุปแบบภาพรวม)

ตอบกลับในรูปแบบ JSON เท่านั้น โดยมีโครงสร้างดังนี้:
{
  "status": "Green" (เมื่อไม่มีข้อชำรุดบกพร่องตามเกณฑ์คะแนนต่ำ เช่น ประเมินได้คะแนนเต็ม) หรือ "Red" (เมื่อได้คะแนนต่ำ หรือมีสิ่งบกพร่องสำคัญอย่างเห็นได้ชัด),
  "findings": ["Weed", "Bird Droppings", "Low Water Level", "Dirty Terminals", ...], (ระบุคำหลักข้อขัดข้องที่ตรวจพบ),
  "summary": "สรุปรายงานผลการวิเคราะห์ระดับน้ำกลั่นและขั้วเฉพาะลูกแบตเตอรี่ที่เห็นชัดเจนที่สุดเพียงลูกเดียว 1 ลูกเท่านั้นระบุหมายเลขลูกให้ชัดเจนที่สุด",
  "category": "Battery" | "Yard" | "Checklist" | "Roof" | "Fence" | "Security" | "Other",
  "score": 100
}`;

          console.log(`Calling Gemini for image: ${img.name}...`);
          const genResult = await generateContentWithRetry(ai, {
            model: "gemini-3.5-flash",
            contents: [
              { 
                parts: [
                  { text: prompt }, 
                  { inlineData: { data: base64, mimeType: img.mimeType || 'image/jpeg' } }
                ] 
              }
            ],
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  status: { type: Type.STRING },
                  findings: { type: Type.ARRAY, items: { type: Type.STRING } },
                  summary: { type: Type.STRING },
                  category: { type: Type.STRING },
                  score: { type: Type.INTEGER }
                },
                required: ["status", "findings", "summary", "category", "score"]
              }
            }
          });

          const analysis = JSON.parse(genResult.text || '{}');
          const resultWithMeta = {
            ...analysis,
            fileId: img.id,
            fileName: img.name,
            folderId: folderId,
            analyzedAt: new Date().toISOString()
          };
          
          // Save to Google Sheets history
          await saveAnalysisResult(resultWithMeta);
          
          // Update cache if it exists
          if (historyCache) {
            historyCache.data.push(resultWithMeta);
          }
          
          return resultWithMeta;
        } catch (err: any) {
          console.error(`Failed to analyze image ${img.name}:`, err.message || err);
          // Return a fallback result instead of null so it's counted
          return {
            fileId: img.id,
            fileName: img.name,
            status: 'Gray',
            findings: ['Error'],
            summary: `ไม่สามารถวิเคราะห์ได้: ${err.message || 'Unknown error'}`,
            analyzedAt: new Date().toISOString()
          };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      individualResults.push(...chunkResults.filter(r => r !== null));
      
      // Small delay between chunks to be nice to the API
      if (i + CHUNK_SIZE < allImages.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (individualResults.length === 0) {
      return res.status(500).json({ error: "ไม่สามารถวิเคราะห์รูปภาพได้เลย" });
    }

    // 6. Aggregate results
    const isRed = individualResults.some(r => r.status === 'Red');
    const allFindings = Array.from(new Set(individualResults.flatMap(r => r.findings || [])));
    
    const redResults = individualResults.filter(r => r.status === 'Red');
    const greenResults = individualResults.filter(r => r.status === 'Green');
    const errorResults = individualResults.filter(r => r.status === 'Gray');
    
    let summaryText = `วิเคราะห์ทั้งหมด ${individualResults.length} ภาพ: พบปัญหา ${redResults.length} ภาพ, ปกติ ${greenResults.length} ภาพ${errorResults.length > 0 ? `, ผิดพลาด ${errorResults.length} ภาพ` : ''}\n`;
    if (redResults.length > 0) {
      summaryText += `ปัญหาที่พบ: ${allFindings.join(', ')}\n`;
      summaryText += redResults.map((r, i) => `- ${r.fileName || `ภาพที่ ${i+1}`}: ${r.summary}`).join('\n');
    } else {
      summaryText += `ทุกภาพอยู่ในสภาพปกติเรียบร้อยดี`;
    }

    // Dynamic Weighting Analysis Aggregation from AI categorized images
    const categoryMapping: any = {
      battery: { count: 0, minScore: 100 },
      yard: { count: 0, minScore: 100 },
      checklist: { count: 0, minScore: 100 },
      roof: { count: 0, minScore: 100 },
      fence: { count: 0, minScore: 100 },
      security: { count: 0, minScore: 100 }
    };

    individualResults.forEach((r: any) => {
      if (!r.category) return;
      const cat = r.category.toLowerCase().trim();
      const scoreVal = typeof r.score === 'number' ? r.score : parseInt(r.score) || 100;
      if (categoryMapping[cat] !== undefined) {
        categoryMapping[cat].count += 1;
        categoryMapping[cat].minScore = Math.min(categoryMapping[cat].minScore, scoreVal);
      }
    });

    const battery_na = categoryMapping.battery.count === 0;
    const battery_score = battery_na ? 100 : categoryMapping.battery.minScore;

    const yard_na = categoryMapping.yard.count === 0;
    const yard_score = yard_na ? 100 : categoryMapping.yard.minScore;

    const checklist_na = categoryMapping.checklist.count === 0;
    const checklist_score = checklist_na ? 100 : categoryMapping.checklist.minScore;

    const roof_na = categoryMapping.roof.count === 0;
    const roof_score = roof_na ? 100 : categoryMapping.roof.minScore;

    const fence_na = categoryMapping.fence.count === 0;
    const fence_score = fence_na ? 100 : categoryMapping.fence.minScore;

    const security_na = categoryMapping.security.count === 0;
    const security_score = security_na ? 100 : categoryMapping.security.minScore;

    const finalAnalysis = {
      status: isRed ? 'Red' : 'Green',
      findings: allFindings,
      summary: summaryText.length > 1000 ? summaryText.substring(0, 997) + "..." : summaryText,
      battery_score,
      battery_na,
      yard_score,
      yard_na,
      checklist_score,
      checklist_na,
      roof_score,
      roof_na,
      fence_score,
      fence_na,
      security_score,
      security_na
    };
    
    // Save to Google Sheets
    try {
      await saveHealthIndexToSheet({
        substationName, month, year,
        status: finalAnalysis.status,
        findings: finalAnalysis.findings,
        summary: finalAnalysis.summary,
        battery_score: finalAnalysis.battery_score,
        battery_na: finalAnalysis.battery_na,
        yard_score: finalAnalysis.yard_score,
        yard_na: finalAnalysis.yard_na,
        checklist_score: finalAnalysis.checklist_score,
        checklist_na: finalAnalysis.checklist_na,
        roof_score: finalAnalysis.roof_score,
        roof_na: finalAnalysis.roof_na,
        fence_score: finalAnalysis.fence_score,
        fence_na: finalAnalysis.fence_na,
        security_score: finalAnalysis.security_score,
        security_na: finalAnalysis.security_na
      });
      console.log(`Saved AI Analysis with dynamic weighting to Google Sheets for ${substationName}`);
    } catch (sheetErr) {
      console.error("Failed to save analysis to Google Sheets:", sheetErr);
    }

    // 7. Save to DB
    const pool = getDbPool();
    if (pool) {
      try {
        const q = `
          INSERT INTO health_index_logs (
            substation_name, month, year, status, findings, summary, analyzed_at,
            battery_score, battery_na,
            yard_score, yard_na,
            checklist_score, checklist_na,
            roof_score, roof_na,
            fence_score, fence_na,
            security_score, security_na
          ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          ON CONFLICT (substation_name, month, year)
          DO UPDATE SET
            status = EXCLUDED.status,
            findings = EXCLUDED.findings,
            summary = EXCLUDED.summary,
            analyzed_at = CURRENT_TIMESTAMP,
            battery_score = EXCLUDED.battery_score,
            battery_na = EXCLUDED.battery_na,
            yard_score = EXCLUDED.yard_score,
            yard_na = EXCLUDED.yard_na,
            checklist_score = EXCLUDED.checklist_score,
            checklist_na = EXCLUDED.checklist_na,
            roof_score = EXCLUDED.roof_score,
            roof_na = EXCLUDED.roof_na,
            fence_score = EXCLUDED.fence_score,
            fence_na = EXCLUDED.fence_na,
            security_score = EXCLUDED.security_score,
            security_na = EXCLUDED.security_na
        `;
        const dbResult = await pool.query(q, [
          substationName, parseInt(month as string), parseInt(year as string), finalAnalysis.status, finalAnalysis.findings, finalAnalysis.summary,
          finalAnalysis.battery_score, finalAnalysis.battery_na,
          finalAnalysis.yard_score, finalAnalysis.yard_na,
          finalAnalysis.checklist_score, finalAnalysis.checklist_na,
          finalAnalysis.roof_score, finalAnalysis.roof_na,
          finalAnalysis.fence_score, finalAnalysis.fence_na,
          finalAnalysis.security_score, finalAnalysis.security_na
        ]);
        console.log(`Saved AI Analysis with dynamic weighting to DB for ${substationName}: ${dbResult.rowCount} rows affected`);
      } catch (dbErr) {
        console.error("Failed to save health index to DB:", dbErr);
      }
    }

    res.json({ ...finalAnalysis, folderId });

  } catch (error: any) {
    console.error("AI Analysis error:", error);
    res.status(500).json({ error: "Failed to analyze: " + error.message });
  }
});

app.get("/api/health-index", async (req, res) => {
  const { month, year } = req.query;
  const filterMonth = parseInt(month as string);
  const filterYear = parseInt(year as string);

  try {
    const list = await getHealthIndexFromSheet();
    if (list.length > 0) {
      const filtered = list.filter(item => item.month === filterMonth && item.year === filterYear);
      return res.json(filtered);
    }
  } catch (sheetErr) {
    console.error("Failed to read health index from Google Sheets database tab:", sheetErr);
  }

  const pool = getDbPool();
  if (!pool) return res.json([]);

  try {
    const result = await pool.query(
      "SELECT * FROM health_index_logs WHERE month = $1 AND year = $2",
      [filterMonth, filterYear]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Failed to fetch health index from Postgres:", err);
    res.status(500).json({ error: "Failed to fetch health index" });
  }
});

app.post("/api/save-health-audit", async (req: any, res: any) => {
  const { 
    substationName, month, year, 
    battery_score, battery_na,
    yard_score, yard_na,
    checklist_score, checklist_na,
    roof_score, roof_na,
    fence_score, fence_na,
    security_score, security_na,
    summary, status 
  } = req.body;

  let sheetSaved = false;
  let sheetError = null;

  // 1. Try to save to Google Sheets (Primary target based on user's instruction)
  try {
    await saveHealthIndexToSheet({
      substationName, month, year,
      status, findings: [], summary,
      battery_score, battery_na,
      yard_score, yard_na,
      checklist_score, checklist_na,
      roof_score, roof_na,
      fence_score, fence_na,
      security_score, security_na
    });
    sheetSaved = true;
  } catch (err: any) {
    console.error("Failed to save health audit to Google Sheets: database", err);
    sheetError = err.message || err;
  }

  // 2. Try to save to Postgres (Secondary/Fallback target)
  const pool = getDbPool();
  if (pool) {
    try {
      const q = `
        INSERT INTO health_index_logs (
          substation_name, month, year, status, findings, summary, analyzed_at,
          battery_score, battery_na,
          yard_score, yard_na,
          checklist_score, checklist_na,
          roof_score, roof_na,
          fence_score, fence_na,
          security_score, security_na
        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (substation_name, month, year)
        DO UPDATE SET
          status = EXCLUDED.status,
          summary = EXCLUDED.summary,
          analyzed_at = CURRENT_TIMESTAMP,
          battery_score = EXCLUDED.battery_score,
          battery_na = EXCLUDED.battery_na,
          yard_score = EXCLUDED.yard_score,
          yard_na = EXCLUDED.yard_na,
          checklist_score = EXCLUDED.checklist_score,
          checklist_na = EXCLUDED.checklist_na,
          roof_score = EXCLUDED.roof_score,
          roof_na = EXCLUDED.roof_na,
          fence_score = EXCLUDED.fence_score,
          fence_na = EXCLUDED.fence_na,
          security_score = EXCLUDED.security_score,
          security_na = EXCLUDED.security_na
      `;
      await pool.query(q, [
        substationName, parseInt(month), parseInt(year), status || 'Green', [], summary || '',
        battery_score !== undefined ? parseInt(battery_score) : 100, !!battery_na,
        yard_score !== undefined ? parseInt(yard_score) : 100, !!yard_na,
        checklist_score !== undefined ? parseInt(checklist_score) : 100, !!checklist_na,
        roof_score !== undefined ? parseInt(roof_score) : 100, !!roof_na,
        fence_score !== undefined ? parseInt(fence_score) : 100, !!fence_na,
        security_score !== undefined ? parseInt(security_score) : 100, !!security_na
      ]);
    } catch (dbErr) {
      console.error("Failed to save health audit to PostgreSQL:", dbErr);
    }
  }

  if (sheetSaved) {
    res.json({ success: true });
  } else {
    if (!pool) {
      res.status(500).json({ error: `ไม่สามารถบันทึกได้: ล้มเหลวจากการเขียนพอร์ตชีต (${sheetError || 'ไม่สามารถเชื่อมต่อ Google Sheets ได้'}) และไม่ได้เชื่อมบริการฐานข้อมูล Postgres` });
    } else {
      res.status(500).json({ error: `ไม่สามารถบันทึกได้เนื่องจาก: ${sheetError || 'ข้อผิดพลาดระบบ Google Sheets'}` });
    }
  }
});

app.get("/api/debug-db", async (req, res) => {
  const pool = getDbPool();
  if (!pool) return res.json({ error: "No DATABASE_URL found in environment variables." });
  try {
    const result = await pool.query("SELECT COUNT(*) FROM inspection_logs");
    const sample = await pool.query("SELECT * FROM inspection_logs ORDER BY timestamp DESC LIMIT 5");
    res.json({ 
      connected: true, 
      count: result.rows[0].count, 
      sample: sample.rows,
      env: {
        hasDbUrl: !!process.env.DATABASE_URL,
        nodeEnv: process.env.NODE_ENV
      }
    });
  } catch (e: any) {
    res.json({ connected: false, error: e.message });
  }
});

export default app;

async function startServer() {
  try {
    await initDb();
  } catch (e) {
    console.error("DB Init failed:", e);
  }

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      // Don't handle API routes here
      if (req.path.startsWith('/api')) return;
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });

    // Only listen if explicitly told to (e.g., Docker), but NOT on Vercel
    if (process.env.RUN_SERVER === "true") {
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on port ${PORT}`);
      });
    }
  }
}

// Only run startServer if not on Vercel or in dev
if (process.env.NODE_ENV !== "production" || process.env.RUN_SERVER === "true") {
  startServer();
}


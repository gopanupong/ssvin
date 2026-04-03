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
async function getAnalysisHistory() {
  const oauth2Client = getOAuth2Client();
  if (!process.env.GOOGLE_REFRESH_TOKEN) return [];
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const sheets = google.sheets({ version: "v4", auth: oauth2Client });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return [];

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "AI_Analysis!A:G",
    });
    const rows = response.data.values || [];
    return rows.slice(1).map(row => ({
      fileId: row[0],
      fileName: row[1],
      folderId: row[2],
      status: row[3],
      findings: row[4] ? row[4].split(',') : [],
      summary: row[5],
      analyzedAt: row[6]
    }));
  } catch (err: any) {
    if (err.code === 404 || (err.response && err.response.status === 400)) {
      await initAnalysisSheet();
    }
    return [];
  }
}

async function initAnalysisSheet() {
  const oauth2Client = getOAuth2Client();
  if (!process.env.GOOGLE_REFRESH_TOKEN) return;
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const sheets = google.sheets({ version: "v4", auth: oauth2Client });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return;

  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
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
  const oauth2Client = getOAuth2Client();
  if (!process.env.GOOGLE_REFRESH_TOKEN) return;
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const sheets = google.sheets({ version: "v4", auth: oauth2Client });
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
  });
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
      <div style="font-family: sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; border: 1px solid #eee; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <h2 style="color: #6366f1; display: flex; align-items: center; gap: 10px;">
          <span style="background: #10b981; color: white; border-radius: 4px; padding: 2px 6px; font-size: 18px;">✓</span> 
          คัดลอก Refresh Token ของคุณ
        </h2>
        <p style="color: #1f2937; font-weight: 500;">นำค่าด้านล่างนี้ไปใส่ใน Vercel Environment Variables ชื่อ</p>
        <p style="font-weight: 800; font-size: 18px; color: #000;">GOOGLE_REFRESH_TOKEN</p>
        
        <textarea readonly style="width: 100%; height: 120px; padding: 15px; border-radius: 8px; border: 1px solid #ddd; background: #f9fafb; font-family: monospace; font-size: 14px; margin: 20px 0; resize: none;">${refreshToken}</textarea>
        
        <div style="background: #fff1f2; padding: 15px; border-radius: 8px; border: 1px solid #ffe4e6; color: #e11d48; font-weight: 600; text-align: center;">
          ขั้นตอนสุดท้าย: เมื่อใส่ค่าใน Vercel แล้ว อย่าลืมกด <span style="color: #f43f5e;">Redeploy</span> เพื่อให้ระบบเริ่มทำงานนะครับ
        </div>
      </div>
    `);
  } catch (error: any) {
    res.status(500).send("Auth Failed: " + error.message);
  }
});

// --- New Drive & AI Analysis Endpoints ---

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
      pageSize: 100
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
    // 1. Check history first
    const history = await getAnalysisHistory();
    const existing = history.find(h => h.fileId === fileId);
    if (existing) {
      return res.json(existing);
    }

    // 2. Download image
    const response = await driveService.files.get({
      fileId,
      alt: 'media'
    }, { responseType: 'arraybuffer' });
    
    const base64 = Buffer.from(response.data as any).toString('base64');

    // 3. Analyze with Gemini
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `คุณคือผู้เชี่ยวชาญด้านความปลอดภัยและความสะอาดของสถานีไฟฟ้าแรงสูง (Power Substation)
กรุณาวิเคราะห์รูปภาพนี้และตรวจสอบสิ่งต่อไปนี้:
1. ความสะอาดเรียบร้อยโดยรวม (Cleanliness and Orderliness)
2. วัชพืชหรือหญ้า (Weed): หากพบหญ้าขึ้นสูงเกิน 5 ซม. ให้รายงานว่า "Weed"
3. คราบขี้นกหรือสิ่งแปลกปลอม (Bird Droppings): หากพบคราบสีขาวหรือสิ่งแปลกปลอมบนอุปกรณ์ไฟฟ้า ให้รายงานว่า "Bird Droppings"

ตอบกลับในรูปแบบ JSON เท่านั้น โดยมีโครงสร้างดังนี้:
{
  "status": "Red" หรือ "Green" (Red หากพบปัญหา Weed หรือ Bird Droppings, Green หากสะอาดเรียบร้อย),
  "findings": ["Weed", "Bird Droppings", ...], (อาเรย์ของคำหลักที่พบ),
  "summary": "สรุปผลการวิเคราะห์สั้นๆ เป็นภาษาไทย"
}`;

    const genResult = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
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
            summary: { type: Type.STRING }
          },
          required: ["status", "findings", "summary"]
        }
      }
    });

    const analysisResult = JSON.parse(genResult.text || '{}');
    const finalResult = {
      fileId,
      fileName,
      folderId,
      ...analysisResult
    };

    // 4. Save to Google Sheets
    await saveAnalysisResult(finalResult);

    res.json(finalResult);
  } catch (error: any) {
    console.error("Analysis error:", error);
    res.status(500).json({ error: error.message });
  }
});

let drive: any = null;
let sheets: any = null;

function getGoogleAuth() {
  // Always get fresh client to pick up any ENV changes
  const oauth2Client = getOAuth2Client();
  
  // Priority 1: OAuth2 Refresh Token
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
    return oauth2Client;
  }

  // Priority 2: Service Account
  const authJson = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (!authJson) return null;
  try {
    const credentials = JSON.parse(authJson);
    return new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: SCOPES
    });
  } catch (err) {
    console.error("Failed to initialize Google Auth:", err);
    return null;
  }
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
    // A substation is complete if it has all required categories covered in the month
    const REQUIRED_CATEGORIES = ['building', 'yard', 'roof', 'annunciation', 'battery', 'grounding', 'security', 'fence', 'lighting', 'checklist'];
    
    const substationCompletion = new Map<string, Set<string>>();
    filteredLogs.forEach(log => {
      const name = (log.substation_name || "").trim();
      if (!substationCompletion.has(name)) {
        substationCompletion.set(name, new Set());
      }
      (log.categories || []).forEach((cat: string) => {
        if (REQUIRED_CATEGORIES.includes(cat)) {
          substationCompletion.get(name)?.add(cat);
        }
      });
    });

    let completedCount = 0;
    substationCompletion.forEach((cats) => {
      if (cats.size >= REQUIRED_CATEGORIES.length) {
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
  const { substationName, month, year, dryRun } = req.body;
  const driveService = getDriveService();
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในระบบ" });
  }
  if (!driveService) {
    return res.status(500).json({ error: "ยังไม่ได้เชื่อมต่อ Google Drive หรือขาด Refresh Token (กรุณาไปที่หน้าตั้งค่าเพื่อเชื่อมต่อใหม่)" });
  }

  try {
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

    // 4. Collect representative images (max 5 from different days/categories)
    const allImages: any[] = [];
    for (const folder of matchingFolders) {
      const filesQuery = await driveService.files.list({
        q: `'${folder.id}' in parents and mimeType contains 'image/' and trashed = false`,
        fields: "files(id, name, mimeType)",
        pageSize: 3
      });
      if (filesQuery.data.files) {
        allImages.push(...filesQuery.data.files);
      }
      if (allImages.length >= 5) break;
    }

    if (allImages.length === 0) {
      const noImageResult = { 
        status: 'Green', 
        findings: [], 
        summary: `ไม่พบรูปภาพในเดือน ${month}/${year}` 
      };
      
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

    // 5. Download images and convert to base64
    const imageParts = [];
    for (const img of allImages) {
      const response = await driveService.files.get({
        fileId: img.id,
        alt: 'media'
      }, { responseType: 'arraybuffer' });
      
      const base64 = Buffer.from(response.data as any).toString('base64');
      imageParts.push({
        inlineData: {
          data: base64,
          mimeType: img.mimeType
        }
      });
    }

    // 6. Analyze with Gemini
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `คุณคือผู้เชี่ยวชาญด้านความปลอดภัยและความสะอาดของสถานีไฟฟ้าแรงสูง (Power Substation)
กรุณาวิเคราะห์รูปภาพเหล่านี้และตรวจสอบสิ่งต่อไปนี้:
1. ความสะอาดเรียบร้อยโดยรวม (Cleanliness and Orderliness)
2. วัชพืชหรือหญ้า (Weed): หากพบหญ้าขึ้นสูงเกิน 5 ซม. ให้รายงานว่า "Weed"
3. คราบขี้นกหรือสิ่งแปลกปลอม (Bird Droppings): หากพบคราบสีขาวหรือสิ่งแปลกปลอมบนอุปกรณ์ไฟฟ้า ให้รายงานว่า "Bird Droppings"

ตอบกลับในรูปแบบ JSON เท่านั้น โดยมีโครงสร้างดังนี้:
{
  "status": "Red" หรือ "Green" (Red หากพบปัญหา Weed หรือ Bird Droppings, Green หากสะอาดเรียบร้อย),
  "findings": ["Weed", "Bird Droppings", ...], (อาเรย์ของคำหลักที่พบ),
  "summary": "สรุปผลการวิเคราะห์สั้นๆ เป็นภาษาไทย"
}`;

    const result = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        { parts: [{ text: prompt }, ...imageParts] }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            status: { type: Type.STRING },
            findings: { type: Type.ARRAY, items: { type: Type.STRING } },
            summary: { type: Type.STRING }
          },
          required: ["status", "findings", "summary"]
        }
      }
    });

    const analysis = JSON.parse(result.text || '{}');
    
    // 7. Save to DB
    const pool = getDbPool();
    if (pool) {
      try {
        const dbResult = await pool.query(
          `INSERT INTO health_index_logs (substation_name, month, year, status, findings, summary)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (substation_name, month, year) 
           DO UPDATE SET status = EXCLUDED.status, findings = EXCLUDED.findings, summary = EXCLUDED.summary, analyzed_at = CURRENT_TIMESTAMP`,
          [substationName, month, year, analysis.status, analysis.findings, analysis.summary]
        );
        console.log(`Saved analysis to DB for ${substationName}: ${dbResult.rowCount} rows affected`);
      } catch (dbErr) {
        console.error("Failed to save health index to DB:", dbErr);
      }
    }

    res.json({ ...analysis, folderId });

  } catch (error: any) {
    console.error("AI Analysis error:", error);
    res.status(500).json({ error: "Failed to analyze: " + error.message });
  }
});

app.get("/api/health-index", async (req, res) => {
  const { month, year } = req.query;
  const pool = getDbPool();
  if (!pool) return res.json([]);

  try {
    const result = await pool.query(
      "SELECT * FROM health_index_logs WHERE month = $1 AND year = $2",
      [month, year]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Failed to fetch health index:", err);
    res.status(500).json({ error: "Failed to fetch health index" });
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


import express from "express";
import multer from "multer";
import { google } from "googleapis";
import { Client } from "pg";
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

// Database Client (Lazy initialization to prevent crash on Vercel if URL is missing)
let dbClient: any = null;

function getDbClient() {
  if (dbClient) return dbClient;
  if (!process.env.DATABASE_URL) return null;
  try {
    dbClient = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    return dbClient;
  } catch (err) {
    console.error("Failed to create DB client:", err);
    return null;
  }
}

async function initDb() {
  const client = getDbClient();
  if (!client) {
    console.warn("DATABASE_URL not found. Database features will be disabled.");
    return;
  }
  try {
    await client.connect();
    await client.query(`
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
    `);
    console.log("PostgreSQL connected and initialized.");
  } catch (err) {
    console.error("Failed to connect to database:", err);
  }
}

// Google Drive & Sheets Setup
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
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

let drive: any = null;
let sheets: any = null;

function getGoogleAuth() {
  // Priority 1: OAuth2 Refresh Token
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    const oauth2Client = getOAuth2Client();
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
  if (drive) return drive;
  const auth = getGoogleAuth();
  if (!auth) return null;
  drive = google.drive({ version: "v3", auth });
  return drive;
}

function getSheetsService() {
  if (sheets) return sheets;
  const auth = getGoogleAuth();
  if (!auth) return null;
  sheets = google.sheets({ version: "v4", auth });
  return sheets;
}

app.use(express.json());

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "SSVI API is running" });
});

const recentSubmissions = new Map<string, number>();

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
    // Ensure we have a valid date
    const dateObj = timestamp ? new Date(timestamp) : new Date();
    const dateStr = dateObj.toLocaleDateString("th-TH", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }).replace(/\//g, ""); 
    
    const parentFolderId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || "1IzXUWJfucyb47Dr32QSVIxBKmoMrWF6J";

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
        resource: folderMetadata,
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
        resource: folderMetadata,
        fields: "id",
      });
      dailyFolderId = folder.data.id;
    }

    // 3. Upload Files to Daily Folder
    for (const file of files) {
      const fileMetadata = {
        name: file.originalname,
        parents: [dailyFolderId],
      };
      const media = {
        mimeType: file.mimetype,
        body: Readable.from(file.buffer),
      };
      await driveService.files.create({
        resource: fileMetadata,
        media: media,
        fields: "id",
      });
    }

    // 3. Log to Database
    const client = getDbClient();
    if (client) {
      try {
        await client.query(
          "INSERT INTO inspection_logs (employee_id, substation_name, gps_lat, gps_lng, folder_id) VALUES ($1, $2, $3, $4, $5)",
          [employeeId || "Unknown", substationName, lat, lng, dailyFolderId]
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
        // Format date/time explicitly for Google Sheets
        const formattedDate = dateObj.toLocaleDateString("th-TH");
        const formattedTime = dateObj.toLocaleTimeString("th-TH", { hour12: false });
        const dateTimeStr = `${formattedDate} ${formattedTime}`;

        const rowData = [
          dateTimeStr,
          (employeeId && String(employeeId).trim()) ? String(employeeId).trim() : "ไม่ระบุ",
          substationName || "ไม่ระบุ",
          lat || "0",
          lng || "0",
          `https://drive.google.com/drive/folders/${dailyFolderId}`,
          "Completed"
        ];
        
        console.log("Final Row Data for Sheets:", rowData);

        await sheetsService.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: "A:G", // Try appending to the first sheet without explicit name
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
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/dashboard-stats", async (req, res) => {
  const { month, year } = req.query;
  const client = getDbClient();
  if (!client) {
    return res.json({
      total: 0,
      recent: [],
    });
  }
  try {
    let query = "SELECT * FROM inspection_logs";
    let countQuery = "SELECT COUNT(DISTINCT substation_name) FROM inspection_logs";
    const params: any[] = [];

    if (month && year) {
      query += " WHERE EXTRACT(MONTH FROM timestamp) = $1 AND EXTRACT(YEAR FROM timestamp) = $2";
      countQuery += " WHERE EXTRACT(MONTH FROM timestamp) = $1 AND EXTRACT(YEAR FROM timestamp) = $2";
      params.push(month, year);
    }

    query += " ORDER BY timestamp DESC LIMIT 100";

    const result = await client.query(query, params);
    const countResult = await client.query(countQuery, params);
    
    res.json({
      total: parseInt(countResult.rows[0].count),
      recent: result.rows,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
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


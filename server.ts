import express from "express";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import { google } from "googleapis";
import { Client } from "pg";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;
const upload = multer({ dest: "uploads/" });

// Database Client
const dbClient = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function initDb() {
  try {
    if (process.env.DATABASE_URL) {
      await dbClient.connect();
      await dbClient.query(`
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
    } else {
      console.warn("DATABASE_URL not found. Database features will be disabled.");
    }
  } catch (err) {
    console.error("Failed to connect to database:", err);
  }
}

// Google Drive & Sheets Setup
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets"
];
let drive: any = null;
let sheets: any = null;

function getGoogleAuth() {
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
app.post("/api/upload-inspection", upload.array("photos"), async (req: any, res: any) => {
  const { employeeId, substationName, lat, lng, timestamp } = req.body;
  const files = req.files as any[];
  const driveService = getDriveService();

  if (!driveService) {
    return res.status(500).json({ error: "Google Drive service not configured" });
  }

  try {
    const dateStr = new Date(timestamp).toLocaleDateString("th-TH", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }).replace(/\//g, ""); // DDMMYY format (roughly)
    
    // Better date format for folder: สามชุก_300169 (as requested)
    // Local time is 2026-02-25
    const folderName = `${substationName}_${dateStr}`;
    const parentFolderId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || "1IzXUWJfucyb47Dr32QSVIxBKmoMrWF6J";

    // 1. Find or Create Folder
    let folderId;
    const folderQuery = await driveService.files.list({
      q: `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed = false`,
      fields: "files(id)",
    });

    if (folderQuery.data.files.length > 0) {
      folderId = folderQuery.data.files[0].id;
    } else {
      const folderMetadata = {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentFolderId],
      };
      const folder = await driveService.files.create({
        resource: folderMetadata,
        fields: "id",
      });
      folderId = folder.data.id;
    }

    // 2. Upload Files
    for (const file of files) {
      const fileMetadata = {
        name: file.originalname,
        parents: [folderId],
      };
      const media = {
        mimeType: file.mimetype,
        body: fs.createReadStream(file.path),
      };
      await driveService.files.create({
        resource: fileMetadata,
        media: media,
        fields: "id",
      });
      // Cleanup local file
      fs.unlinkSync(file.path);
    }

    // 3. Log to Database
    if (process.env.DATABASE_URL) {
      await dbClient.query(
        "INSERT INTO inspection_logs (employee_id, substation_name, gps_lat, gps_lng, folder_id) VALUES ($1, $2, $3, $4, $5)",
        [employeeId, substationName, lat, lng, folderId]
      );
    }

    // 4. Log to Google Sheets
    const sheetsService = getSheetsService();
    const sheetId = process.env.GOOGLE_SHEET_ID || "1WpvuQnhXzufiBmSRSaEnkRFs9BJf5H4fIWZ0xoYC8iw";
    if (sheetsService && sheetId) {
      try {
        await sheetsService.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: "Sheet1!A:G",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[
              new Date(timestamp).toLocaleString("th-TH"),
              employeeId,
              substationName,
              lat,
              lng,
              `https://drive.google.com/drive/folders/${folderId}`,
              "Completed"
            ]]
          }
        });
      } catch (sheetErr) {
        console.error("Failed to log to Google Sheets:", sheetErr);
      }
    }

    res.json({ success: true, folderId });
  } catch (error: any) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/dashboard-stats", async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.json({
      total: 0,
      recent: [],
      bySubstation: {}
    });
  }
  try {
    const result = await dbClient.query("SELECT * FROM inspection_logs ORDER BY timestamp DESC LIMIT 50");
    res.json({
      total: result.rowCount,
      recent: result.rows,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

async function startServer() {
  await initDb();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

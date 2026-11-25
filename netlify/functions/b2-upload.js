
const {
  initializeApp,
  cert,
  getApps
} = require("firebase-admin/app");

const { getAuth } = require("firebase-admin/auth");

const {
  S3Client,
  PutObjectCommand
} = require("@aws-sdk/client-s3");

const crypto = require("crypto");

// FIREBASE ADMIN
if (!getApps().length) {
  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT
  );

  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

// BACKBLAZE B2
const s3 = new S3Client({
  endpoint: process.env.B2_ENDPOINT,
  region: process.env.B2_REGION,
  credentials: {
    accessKeyId: process.env.B2_APPLICATION_KEY_ID,
    secretAccessKey: process.env.B2_APPLICATION_KEY
  }
});

// UPLOAD SETTINGS
const MAX_SIZE = 4 * 1024 * 1024;

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "application/pdf"
];

// UPLOAD FUNCTION
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method not allowed"
    };
  }

  try {
    const authHeader =
      event.headers.authorization ||
      event.headers.Authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return {
        statusCode: 401,
        body: "Authentication required"
      };
    }

    const token = authHeader.slice(7);
    const decoded = await getAuth().verifyIdToken(token);

    const {
      fileName,
      contentType,
      fileData
    } = JSON.parse(event.body || "{}");

    if (
      !fileName ||
      !contentType ||
      !fileData ||
      !ALLOWED_TYPES.includes(contentType)
    ) {
      return {
        statusCode: 400,
        body: "Invalid file information"
      };
    }

    const buffer = Buffer.from(fileData, "base64");

    if (
      buffer.length === 0 ||
      buffer.length > MAX_SIZE
    ) {
      return {
        statusCode: 413,
        body: "File must be 4MB or smaller"
      };
    }

    const safeName = fileName
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 100);

    const key =
      `uploads/${decoded.uid}/${crypto.randomUUID()}-${safeName}`;

    await s3.send(new PutObjectCommand({
      Bucket: process.env.B2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType
    }));

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        success: true,
        key
      })
    };

  } catch (error) {
    console.error("B2 upload error:", error.message);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Upload failed"
      })
    };
  }
};
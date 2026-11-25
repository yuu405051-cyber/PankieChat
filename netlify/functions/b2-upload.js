
const {
  initializeApp,
  cert,
  getApps
} = require("firebase-admin/app");

const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");

const {
  S3Client,
  PutObjectCommand
} = require("@aws-sdk/client-s3");

const crypto = require("crypto");

if (!getApps().length) {
  initializeApp({
    credential: cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    ),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

const db = getDatabase();

const s3 = new S3Client({
  endpoint: process.env.B2_ENDPOINT,
  region: process.env.B2_REGION,
  credentials: {
    accessKeyId: process.env.B2_APPLICATION_KEY_ID,
    secretAccessKey: process.env.B2_APPLICATION_KEY
  }
});

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

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const authHeader =
      event.headers.authorization ||
      event.headers.Authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return { statusCode: 401, body: "Authentication required" };
    }

    const decoded = await getAuth().verifyIdToken(
      authHeader.slice(7)
    );

    const {
      fileName,
      contentType,
      fileData,
      roomType,
      roomId
    } = JSON.parse(event.body || "{}");

    if (
      typeof fileName !== "string" ||
      typeof contentType !== "string" ||
      typeof fileData !== "string" ||
      typeof roomId !== "string" ||
      !["general", "private"].includes(roomType) ||
      !ALLOWED_TYPES.includes(contentType)
    ) {
      return { statusCode: 400, body: "Invalid file information" };
    }

    let messagePath;

    if (roomType === "general") {
      messagePath = "rooms/general/messages";
    } else {
      const chatSnapshot = await db.ref(
        `userChats/${decoded.uid}/${roomId}`
      ).get();

      const chat = chatSnapshot.val();

      if (!chat?.peerUid) {
        return { statusCode: 403, body: "Access denied" };
      }

      const expectedRoomId = [
        decoded.uid,
        chat.peerUid
      ].sort().join("_");

      if (roomId !== expectedRoomId) {
        return { statusCode: 403, body: "Access denied" };
      }

      const peerSnapshot = await db.ref(
        `userChats/${chat.peerUid}/${roomId}/peerUid`
      ).get();

      if (peerSnapshot.val() !== decoded.uid) {
        return { statusCode: 403, body: "Access denied" };
      }

      messagePath = `privateChats/${roomId}/messages`;
    }

    const buffer = Buffer.from(fileData, "base64");

    if (
      buffer.length === 0 ||
      buffer.length > MAX_SIZE
    ) {
      return { statusCode: 413, body: "File must be 4MB or smaller" };
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

    const messageRef = db.ref(messagePath).push();

    const messageData = {
      text: fileName,
      uid: decoded.uid,
      senderName: "User",
      createdAt: Date.now(),
      status: "sent",
      media: {
        key,
        name: safeName,
        contentType,
        size: buffer.length
      }
    };

    await messageRef.set(messageData);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        key,
        messageId: messageRef.key
      })
    };

  } catch (error) {
    console.error("B2 upload error:", error.message);

    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Upload failed" })
    };
  }
};
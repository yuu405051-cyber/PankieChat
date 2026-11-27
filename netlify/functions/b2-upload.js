const admin = require("firebase-admin");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { randomUUID } = require("crypto");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

const db = admin.database();

const s3 = new S3Client({
  endpoint: process.env.B2_ENDPOINT,
  region: process.env.B2_REGION || "eu-central-003",
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APPLICATION_KEY
  }
});

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "application/pdf"
]);

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function safeFileName(name) {
  return String(name || "upload")
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 100) || "upload";
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return response(405, { error: "Method not allowed" });
  }

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return response(401, { error: "Authentication required" });

    const decoded = await admin.auth().verifyIdToken(match[1]);
    const uid = decoded.uid;

    const payload = JSON.parse(event.body || "{}");
    const { fileName, contentType, base64, roomType, roomId, messageId } = payload;

    if (!fileName || !contentType || !base64 || !roomType || !roomId || !messageId) {
      return response(400, { error: "Missing upload details" });
    }

    if (!ALLOWED_TYPES.has(contentType)) {
      return response(415, { error: "File type not supported" });
    }

    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length || buffer.length > MAX_BYTES) {
      return response(413, { error: "File must be smaller than 4 MB" });
    }

    let members = [uid];

    if (roomType === "private") {
      const parts = String(roomId).split("_");
      if (parts.length !== 2 || parts[0] === parts[1] || !parts.includes(uid)) {
        return response(403, { error: "Invalid private chat" });
      }

      const peerUid = parts.find((part) => part !== uid);
      const [myChat, peerChat] = await Promise.all([
        db.ref(`userChats/${uid}/${roomId}`).get(),
        db.ref(`userChats/${peerUid}/${roomId}`).get()
      ]);

      if (!myChat.exists() || !peerChat.exists()) {
        return response(403, { error: "You are not a member of this chat" });
      }
      members = [uid, peerUid];
    } else if (roomType !== "general" || roomId !== "general") {
      return response(400, { error: "Invalid chat destination" });
    }

    const messagePath = roomType === "general"
      ? `rooms/general/messages/${messageId}`
      : `privateChats/${roomId}/messages/${messageId}`;

    const existingMessage = await db.ref(messagePath).get();
    if (existingMessage.exists()) {
      return response(409, { error: "Message ID already exists" });
    }

    const key = `uploads/${uid}/${randomUUID()}-${safeFileName(fileName)}`;

    await s3.send(new PutObjectCommand({
      Bucket: process.env.B2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType
    }));

    const createdAt = Date.now();
    const message = {
      text: safeFileName(fileName),
      uid,
      senderName: "User",
      createdAt,
      status: "sent",
      media: {
        key,
        name: safeFileName(fileName),
        contentType,
        size: buffer.length
      }
    };

    await db.ref(messagePath).set(message);

    const preview = contentType.startsWith("image/")
      ? "📷 Photo"
      : contentType.startsWith("video/")
        ? "🎬 Video"
        : contentType.startsWith("audio/")
          ? "🎵 Audio"
          : "📎 File";

    const updates = {};
    for (const memberUid of members) {
      updates[`userChats/${memberUid}/${roomId}/lastMessage`] = preview;
      updates[`userChats/${memberUid}/${roomId}/lastMessageAt`] = createdAt;
    }

    const peerUid = members.find((memberUid) => memberUid !== uid);
    if (peerUid) {
      const unreadRef = db.ref(`userChats/${peerUid}/${roomId}/unreadCount`);
      await db.ref().update(updates);
      await unreadRef.transaction((value) => (Number(value) || 0) + 1);
    } else {
      await db.ref().update(updates);
    }

    return response(200, { ok: true, messageId, message });
  } catch (error) {
    console.error("B2 upload error:", error);
    return response(500, { error: "Upload failed" });
  }
};

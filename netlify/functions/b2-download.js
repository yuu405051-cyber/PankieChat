const admin = require("firebase-admin");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

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

async function bodyToBuffer(body, maxBytes) {
  const chunks = [];
  let total = 0;

  for await (const chunk of body) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error("FILE_TOO_LARGE");
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
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
    const { key, roomType, roomId, messageId } = payload;

    if (!key || !roomType || !roomId || !messageId) {
      return response(400, { error: "Missing download details" });
    }

    if (typeof key !== "string" || !key.startsWith("uploads/") || key.includes("..")) {
      return response(400, { error: "Invalid media key" });
    }

    let allowed = false;
    let allowedUploaderPrefix = `uploads/${uid}/`;

    if (roomType === "general" && roomId === "general") {
      const messageSnap = await db.ref(
        `rooms/general/messages/${messageId}`
      ).get();

      if (messageSnap.exists()) {
        const message = messageSnap.val();
        allowed = message?.media?.key === key;
        allowedUploaderPrefix = `uploads/${message?.uid}/`;
      }
    } else if (roomType === "private") {
      const parts = String(roomId).split("_");

      if (
        parts.length !== 2 ||
        parts[0] === parts[1] ||
        !parts.includes(uid)
      ) {
        return response(403, { error: "Invalid private chat" });
      }

      const peerUid = parts.find((part) => part !== uid);

      const [myChat, peerChat, messageSnap] = await Promise.all([
        db.ref(`userChats/${uid}/${roomId}`).get(),
        db.ref(`userChats/${peerUid}/${roomId}`).get(),
        db.ref(`privateChats/${roomId}/messages/${messageId}`).get()
      ]);

      if (!myChat.exists() || !peerChat.exists()) {
        return response(403, { error: "You are not a member of this chat" });
      }

      if (messageSnap.exists()) {
        const message = messageSnap.val();
        allowed = message?.media?.key === key;
        allowedUploaderPrefix = `uploads/${message?.uid}/`;
      }
    } else {
      return response(400, { error: "Invalid chat destination" });
    }

    if (!allowed || !key.startsWith(allowedUploaderPrefix)) {
      return response(403, { error: "Media access denied" });
    }

    const result = await s3.send(new GetObjectCommand({
      Bucket: process.env.B2_BUCKET_NAME,
      Key: key
    }));

    const buffer = await bodyToBuffer(result.Body, MAX_BYTES);

    return response(200, {
      ok: true,
      fileName: key.split("/").pop(),
      contentType: result.ContentType || "application/octet-stream",
      size: buffer.length,
      base64: buffer.toString("base64")
    });
  } catch (error) {
    if (error.message === "FILE_TOO_LARGE") {
      return response(413, { error: "File is larger than 4 MB" });
    }

    console.error("B2 download error:", error);
    return response(500, { error: "Download failed" });
  }
};

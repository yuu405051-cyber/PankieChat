
const {
  initializeApp,
  cert,
  getApps
} = require("firebase-admin/app");

const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");

const {
  S3Client,
  GetObjectCommand
} = require("@aws-sdk/client-s3");

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

    const { key, roomType, roomId, messageId } =
      JSON.parse(event.body || "{}");

    if (
      typeof key !== "string" ||
      typeof roomId !== "string" ||
      typeof messageId !== "string" ||
      !["general", "private"].includes(roomType)
    ) {
      return { statusCode: 400, body: "Invalid request" };
    }

    let messagePath;

    if (roomType === "general") {
      messagePath = `rooms/general/messages/${messageId}`;
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

      messagePath = `privateChats/${roomId}/messages/${messageId}`;
    }

    const messageSnapshot = await db.ref(messagePath).get();
    const message = messageSnapshot.val();

    if (
      !message ||
      !message.uid ||
      message.media?.key !== key ||
      !key.startsWith(`uploads/${message.uid}/`)
    ) {
      return { statusCode: 403, body: "Access denied" };
    }

    const result = await s3.send(new GetObjectCommand({
      Bucket: process.env.B2_BUCKET,
      Key: key
    }));

    const bytes = await result.Body.transformToByteArray();
    console.log("B2 DOWNLOAD DEBUG:", {
      contentType: result.ContentType,
      size: bytes.length,
      keyFound: !!result.ContentType
    });

    if (bytes.length > 4 * 1024 * 1024) {
      return { statusCode: 413, body: "File too large" };
    }

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": result.ContentType || "application/octet-stream",
        "Cache-Control": "private, no-store"
      },
      body: Buffer.from(bytes).toString("base64")
    };

  } catch (error) {
    console.error("B2 download error:", error.message);

    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Download failed" })
    };
  }
};
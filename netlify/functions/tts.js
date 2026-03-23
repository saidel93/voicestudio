const https = require("https");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Api-Key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function openaiTTS(apiKey, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);

    const options = {
      hostname: "api.openai.com",
      path: "/v1/audio/speech",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: res.statusCode, buffer });
      });
      res.on("error", reject);
    });

    req.on("error", reject);

    // 23 second timeout on the socket
    req.setTimeout(23000, () => {
      req.destroy(new Error("TIMEOUT"));
    });

    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
  }

  // API key
  const apiKey =
    event.headers["x-api-key"] ||
    event.headers["X-Api-Key"] ||
    event.headers["X-API-KEY"];

  if (!apiKey || !apiKey.startsWith("sk-")) {
    return {
      statusCode: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "Invalid or missing API key." } }),
    };
  }

  // Parse body
  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "Invalid JSON body." } }),
    };
  }

  if (!payload.input || typeof payload.input !== "string") {
    return {
      statusCode: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "Missing input text." } }),
    };
  }

  // Call OpenAI
  try {
    const { status, buffer } = await openaiTTS(apiKey, {
      model: payload.model || "tts-1-hd",
      input: payload.input,
      voice: payload.voice || "nova",
      speed: payload.speed || 1.0,
      response_format: "mp3",
    });

    if (status !== 200) {
      // Pass OpenAI error back as-is
      return {
        statusCode: status,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: buffer.toString("utf8"),
      };
    }

    return {
      statusCode: 200,
      headers: {
        ...CORS,
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
      body: buffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    const isTimeout = err.message === "TIMEOUT";
    return {
      statusCode: isTimeout ? 504 : 502,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({
        error: {
          message: isTimeout
            ? "Request timed out. Please use shorter text (one paragraph at a time)."
            : `Server error: ${err.message}`,
        },
      }),
    };
  }
};

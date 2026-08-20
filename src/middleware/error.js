const ALLOWED_ORIGIN = "https://naati.prepsmart.au";

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,Stripe-Signature");
  }
}

export function notFound(req, res) {
    setCorsHeaders(req, res);
    return res.status(404).json({ success: false, message: "Route not found" });
  }
  
  export function errorHandler(err, req, res, next) {
    console.error(`[ERROR] ${req.method} ${req.originalUrl}`, err);

    // Ensure CORS headers are present even on error responses
    setCorsHeaders(req, res);

    // Handle Multer-specific errors with appropriate status codes
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ success: false, message: "File too large (max 25 MB)" });
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({ success: false, message: `Unexpected file field: ${err.field}` });
    }

    const status = Number(err.status || 500);
    const message = status === 500 ? "Server error" : err.message || "Server error";
    return res.status(status).json({ success: false, message });
  }
  
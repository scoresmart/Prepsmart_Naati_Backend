export function notFound(req, res) {
    return res.status(404).json({ success: false, message: "Route not found" });
  }
  
  export function errorHandler(err, req, res, next) {
    const status = Number(err.status || 500);
    const message = err.message || "Server error";
    console.error(`[ErrorHandler] ${req.method} ${req.path} → ${status}: ${message}`, err.stack || "");
    return res.status(status).json({ success: false, message });
  }
  
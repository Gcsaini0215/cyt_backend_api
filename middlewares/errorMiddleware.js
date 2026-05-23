export const notFound = (req, res, next) => {
  const error = new Error(`Not found -  ${req.originalUrl}`);
  res.status(404);
  next(error);
};

export const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode);
  
  // Ensure CORS headers are present even in error responses
  const origin = req.get('origin');
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  res.json({
    message: err.message,
    status: false,
    data: null,
    statusCode: res.statusCode,
    stack: process.env.NODE_ENV === "production" ? null : err.stack,
  });
};

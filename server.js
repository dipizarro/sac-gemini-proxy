const express = require("express");
const cors = require("cors");
const config = require("./src/config/config");
const routes = require("./src/routes");
const errorHandler = require("./src/middlewares/errorHandler");

const app = express();

app.use(express.json());

// CORS configuration
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (config.cors.allowedOrigins.length === 0) return callback(null, true);
      if (config.cors.allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("CORS blocked for origin: " + origin));
    },
  })
);

// App routes
app.use("/", routes);

// 404 Fallback Middleware
app.use((req, res, next) => {
    res.status(404).json({ success: false, error: `Ruta no encontrada: ${req.method} ${req.url}` });
});

// Centralized error handler
app.use(errorHandler);

app.listen(config.port, () => console.log(`Listening on http://localhost:${config.port}`));

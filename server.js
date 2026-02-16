const express = require("express");
const cors = require("cors");
const config = require("./src/config/config");
const routes = require("./src/routes");

const app = express();
app.use(express.json());

app.use(
  cors({
    origin: function (origin, callback) {
      // Permite requests sin origin (curl/postman)
      if (!origin) return callback(null, true);

      if (config.cors.allowedOrigins.length === 0) return callback(null, true);

      if (config.cors.allowedOrigins.includes(origin)) return callback(null, true);

      return callback(new Error("CORS blocked for origin: " + origin));
    },
  })
);

app.use("/", routes);

app.listen(config.port, () => console.log(`Listening on http://localhost:${config.port}`));

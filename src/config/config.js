require("dotenv").config();

module.exports = {
    port: process.env.PORT || 3000,
    gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        modelName: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    },
    datasphere: {
        url: process.env.DATASPHERE_ODATA_URL,
        user: process.env.DATASPHERE_USER,
        pass: process.env.DATASPHERE_PASS,
        exportUrl: process.env.DATASPHERE_EXPORT_URL,
        movMatPath: process.env.DATASPHERE_MOVMAT_PATH || "3V_MM_MOVMAT_01_3M", // Default view name
        oauth: {
            tokenUrl: process.env.DS_TOKEN_URL,
            clientId: process.env.DS_CLIENT_ID,
            clientSecret: process.env.DS_CLIENT_SECRET,
        }
    },
    richSummary: process.env.RICH_SUMMARY === "1",
    cors: {
        allowedOrigins: (process.env.ALLOWED_ORIGINS || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
    },
};

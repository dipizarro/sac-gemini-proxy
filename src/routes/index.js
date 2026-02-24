const express = require("express");
const router = express.Router();
const ChatController = require("../controllers/ChatController");
const WidgetController = require("../controllers/WidgetController");

router.get("/health", (req, res) => {
    res.json({ ok: true, service: "sac-gemini-proxy" });
});

router.post("/chat", (req, res) => ChatController.handleChat(req, res));
router.get("/ds/movmat", (req, res) => ChatController.proxyDatasphere(req, res));
router.get("/csv/preview", (req, res) => ChatController.getCsvPreview(req, res));

router.get("/widget/main.js", (req, res) => WidgetController.serveWidget(req, res));
router.get("/demo", (req, res) => WidgetController.serveDemo(req, res));

// Export Preview
const ExportController = require("../controllers/ExportController");
router.get("/ds/export/preview", (req, res) => ExportController.getPreview(req, res));

// CSV Management
const CsvController = require("../controllers/CsvController");
router.get("/csv/status", (req, res) => CsvController.getStatus(req, res));
router.post("/csv/reload", (req, res) => CsvController.reload(req, res));
router.get("/csv/summary", (req, res) => CsvController.getSummary(req, res));
router.get("/csv/profile", (req, res) => CsvController.getProfile(req, res));
router.get("/csv/query/distinct-centers", (req, res) => CsvController.getDistinctCenters(req, res));
router.get("/csv/query/movements", (req, res) => ChatController.getCsvMovementsByDate(req, res));
router.get("/csv/query/top-centers", (req, res) => ChatController.getCsvTopCentersByMovements(req, res));
router.get("/csv/query/distinct-centers-range", (req, res) => ChatController.getCsvDistinctCentersRange(req, res));

// Insight Engine Endpoints
router.get("/csv/insights/compare-months", (req, res) => ChatController.getCsvInsightCompareMonths(req, res));
router.get("/csv/insights/max-active-day", (req, res) => ChatController.getCsvInsightMaxActiveDay(req, res));
router.get("/csv/insights/quarter", (req, res) => ChatController.getCsvInsightQuarter(req, res));
router.get("/csv/insights/prioritize", (req, res) => ChatController.getCsvInsightPrioritize(req, res));
router.get("/csv/insights/diff-centers", (req, res) => ChatController.getCsvInsightDiffCenters(req, res));

module.exports = router;

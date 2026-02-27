const express = require("express");
const router = express.Router();

const ChatController = require("../controllers/ChatController");
const CsvController = require("../controllers/CsvController");
const WidgetController = require("../controllers/WidgetController");
const ExportController = require("../controllers/ExportController");

router.get("/health", (req, res) => res.json({ success: true, service: "sac-gemini-proxy" }));

// Chat & Datasphere Proxy
router.post("/chat", ChatController.handleChat.bind(ChatController));
router.get("/ds/movmat", ChatController.proxyDatasphere.bind(ChatController));

// Widget UI
router.get("/widget/main.js", WidgetController.serveWidget.bind(WidgetController));
router.get("/demo", WidgetController.serveDemo.bind(WidgetController));

// Export Preview
router.get("/ds/export/preview", ExportController.getPreview.bind(ExportController));

// CSV Management
router.get("/csv/status", CsvController.getStatus.bind(CsvController));
router.post("/csv/reload", CsvController.reload.bind(CsvController));
router.get("/csv/summary", CsvController.getSummary.bind(CsvController));
router.get("/csv/profile", CsvController.getProfile.bind(CsvController));
router.get("/csv/preview", CsvController.getCsvPreview.bind(CsvController));

// CSV Queries
router.get("/csv/query/distinct-centers", CsvController.getDistinctCenters.bind(CsvController));
router.get("/csv/query/movements", CsvController.getCsvMovementsByDate.bind(CsvController));
router.get("/csv/query/top-centers", CsvController.getCsvTopCentersByMovements.bind(CsvController));
router.get("/csv/query/distinct-centers-range", CsvController.getCsvDistinctCentersRange.bind(CsvController));
router.get("/csv/query/suma-neta", CsvController.getCsvSumaNetaByGroupAndDate.bind(CsvController));

// Insight Engine Endpoints
router.get("/csv/insights/compare-months", CsvController.getCsvInsightCompareMonths.bind(CsvController));
router.get("/csv/insights/max-active-day", CsvController.getCsvInsightMaxActiveDay.bind(CsvController));
router.get("/csv/insights/quarter", CsvController.getCsvInsightQuarter.bind(CsvController));
router.get("/csv/insights/prioritize", CsvController.getCsvInsightPrioritize.bind(CsvController));
router.get("/csv/insights/diff-centers", CsvController.getCsvInsightDiffCenters.bind(CsvController));
router.get("/csv/insights/compare-sumaneta", CsvController.getCsvInsightCompareSumaNeta.bind(CsvController));
router.get("/csv/insights/group-centers", CsvController.getCsvInsightGroupCenters.bind(CsvController));
router.get("/csv/insights/material-diff", CsvController.getCsvInsightMaterialDiff.bind(CsvController));

module.exports = router;

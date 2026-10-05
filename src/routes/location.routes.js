const express = require("express");
const router = express.Router();
const { auth, requireRole } = require("../middleware/authMiddleware");
const {
  generateLocations,
  listLocations,
  deleteLocation,
} = require("../controllers/location.controller");

// POST /api/locations/generate — synchronize locations from Runchise.
router.post("/generate", auth, requireRole("admin"), generateLocations);

// GET /api/locations
router.get("/", listLocations);

// DELETE /api/locations/:location_id
router.delete(
  "/:location_id",
  auth,
  requireRole("admin", "marketing"),
  deleteLocation,
);

module.exports = router;

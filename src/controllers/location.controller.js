const { successRequest, badRequest } = require("../utils/responseReuest");
const {
  generateLocationService,
  listLocationsService,
  deleteLocationService,
} = require("../services/location.service");

async function generateLocations(req, res) {
  const result = await generateLocationService();

  return successRequest({
    res,
    code: result.code,
    data: result.data,
    message: result.message,
  });
}

async function listLocations(req, res) {
  try {
    const {
      query = "",
      city = "",
      status = "",
      branch_type = "",
      sub_brand_id = "",
      take = 10,
      skip = 0,
    } = req.query;

    const parsedTake = Math.min(Number.parseInt(take, 10) || 10, 100);
    const parsedSkip = Math.max(Number.parseInt(skip, 10) || 0, 0);

    const result = await listLocationsService({
      query,
      city,
      status,
      branch_type,
      sub_brand_id,
      take: parsedTake,
      skip: parsedSkip,
    });

    return successRequest({
      res,
      code: 200,
      data: result,
      message: "Locations retrieved successfully.",
    });
  } catch (error) {
    return badRequest({
      res,
      code: 500,
      error: error.message,
    });
  }
}

async function deleteLocation(req, res) {
  try {
    const { location_id } = req.params;

    if (!location_id) {
      return badRequest({
        res,
        code: 400,
        error: "Location ID is required",
      });
    }

    const result = await deleteLocationService(location_id);

    if (result.code >= 400) {
      return badRequest({
        res,
        code: result.code,
        error: result.message,
      });
    }

    return successRequest({
      res,
      code: result.code,
      data: result.data,
      message: result.message,
    });
  } catch (error) {
    return badRequest({
      res,
      code: 500,
      error: error.message,
    });
  }
}

module.exports = { generateLocations, listLocations, deleteLocation };

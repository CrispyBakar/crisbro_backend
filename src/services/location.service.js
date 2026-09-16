const prisma = require("../lib/prisma");
const { listAllLocations } = require("./runchise.service");

function optionalString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function getRunchiseSubBrandIds(value) {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value
        .map((subBrand) => {
          if (subBrand && typeof subBrand === "object") {
            return Number(subBrand.id);
          }
          return Number(subBrand);
        })
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];
}

function mapRunchiseLocation(location, subBrandIdByRunchiseId = new Map()) {
  const runchiseId = Number(location?.id);
  const name = optionalString(location?.name);

  if (!Number.isInteger(runchiseId) || runchiseId <= 0 || !name) return null;

  return {
    runchise_id: runchiseId,
    name,
    shipping_address: optionalString(
      location.shipping_address ?? location.address,
    ),
    city: optionalString(location.city),
    postal_code: optionalString(location.postal_code),
    province: optionalString(location.province),
    country: optionalString(location.country),
    contact_number: optionalString(location.contact_number ?? location.phone),
    status: optionalString(location.status),
    branch_type: optionalString(location.branch_type),
    gmap_address: optionalString(
      location.gmap_address ?? location.google_maps_address,
    ),
    longitude: optionalString(location.longitude),
    latitude: optionalString(location.latitude),
    sub_brands: getRunchiseSubBrandIds(
      location.sub_brands ?? location.sub_brand_ids,
    )
      .map((runchiseId) => subBrandIdByRunchiseId.get(runchiseId))
      .filter(Boolean),
  };
}

async function generateLocationService() {
  const remoteLocations = await listAllLocations();
  const runchiseSubBrandIds = [
    ...new Set(
      remoteLocations.flatMap((location) =>
        getRunchiseSubBrandIds(location?.sub_brands ?? location?.sub_brand_ids),
      ),
    ),
  ];
  const localSubBrands = runchiseSubBrandIds.length
    ? await prisma.subBrand.findMany({
        where: { runchise_id: { in: runchiseSubBrandIds } },
        select: { sub_brand_id: true, runchise_id: true },
      })
    : [];
  const subBrandIdByRunchiseId = new Map(
    localSubBrands.map((subBrand) => [
      subBrand.runchise_id,
      subBrand.sub_brand_id,
    ]),
  );
  const unmappedSubBrandIds = runchiseSubBrandIds.filter(
    (runchiseId) => !subBrandIdByRunchiseId.has(runchiseId),
  );
  const locationsByRunchiseId = new Map();
  let skipped = 0;

  for (const remoteLocation of remoteLocations) {
    const location = mapRunchiseLocation(
      remoteLocation,
      subBrandIdByRunchiseId,
    );
    if (!location) {
      skipped += 1;
      continue;
    }
    locationsByRunchiseId.set(location.runchise_id, location);
  }

  const locations = [...locationsByRunchiseId.values()];
  const existingLocations = locations.length
    ? await prisma.location.findMany({
        where: {
          runchise_id: {
            in: locations.map((location) => location.runchise_id),
          },
        },
        select: { location_id: true, runchise_id: true },
      })
    : [];
  const existingByRunchiseId = new Map(
    existingLocations.map((location) => [
      location.runchise_id,
      location.location_id,
    ]),
  );

  let created = 0;
  let updated = 0;
  const operations = locations.map((location) => {
    const locationId = existingByRunchiseId.get(location.runchise_id);
    if (locationId) {
      updated += 1;
      return prisma.location.update({
        where: { location_id: locationId },
        data: location,
      });
    }

    created += 1;
    return prisma.location.create({ data: location });
  });

  if (operations.length) await prisma.$transaction(operations);

  return {
    code: 200,
    data: {
      total_from_runchise: remoteLocations.length,
      processed: locations.length,
      created,
      updated,
      skipped,
      unmapped_sub_brand_ids: unmappedSubBrandIds,
    },
    message: "Locations berhasil disinkronkan dari Runchise.",
  };
}

async function listLocationsService({
  query,
  city,
  status,
  branch_type,
  sub_brand_id,
  take,
  skip,
} = {}) {
  const filters = [];

  const search = optionalString(query);
  if (search) {
    filters.push({
      OR: ["name", "city", "province", "shipping_address"].map((field) => ({
        [field]: { contains: search, mode: "insensitive" },
      })),
    });
  }

  const cityFilter = optionalString(city);
  if (cityFilter) {
    filters.push({ city: { equals: cityFilter, mode: "insensitive" } });
  }

  const statusFilter = optionalString(status);
  if (statusFilter) filters.push({ status: statusFilter });

  const branchTypeFilter = optionalString(branch_type);
  if (branchTypeFilter) filters.push({ branch_type: branchTypeFilter });

  const subBrandIdFilter = optionalString(sub_brand_id);
  if (subBrandIdFilter) filters.push({ sub_brands: { has: subBrandIdFilter } });

  const where = filters.length ? { AND: filters } : undefined;

  const [total, locations] = await prisma.$transaction([
    prisma.location.count({ where }),
    prisma.location.findMany({
      where,
      take,
      skip,
      orderBy: [{ city: "asc" }, { name: "asc" }, { location_id: "asc" }],
    }),
  ]);
  const subBrandIds = [
    ...new Set(locations.flatMap((location) => location.sub_brands)),
  ];
  const subBrands = subBrandIds.length
    ? await prisma.subBrand.findMany({
        where: { sub_brand_id: { in: subBrandIds } },
        select: {
          sub_brand_id: true,
          runchise_id: true,
          name: true,
          image_url: true,
          location_type: true,
          is_select_all_location: true,
          enable_online_order: true,
        },
      })
    : [];
  const subBrandById = new Map(
    subBrands.map((subBrand) => [subBrand.sub_brand_id, subBrand]),
  );

  return {
    total,
    total_page: take ? Math.ceil(total / take) : 1,
    locations: locations.map((location) => ({
      ...location,
      sub_brands: location.sub_brands
        .map((subBrandId) => subBrandById.get(subBrandId))
        .filter(Boolean),
    })),
  };
}

async function deleteLocationService(locationId) {
  const customerCount = await prisma.customer.count({
    where: { owner_location_id: locationId },
  });

  if (customerCount) {
    return {
      code: 409,
      data: null,
      message: `Location tidak dapat dihapus karena masih terhubung dengan ${customerCount} customer.`,
    };
  }

  try {
    const deletedLocation = await prisma.location.delete({
      where: { location_id: locationId },
    });

    return {
      code: 200,
      data: deletedLocation,
      message: "Location berhasil dihapus.",
    };
  } catch (error) {
    if (error?.code === "P2025") {
      return {
        code: 404,
        data: null,
        message: "Location tidak ditemukan.",
      };
    }
    throw error;
  }
}

module.exports = {
  generateLocationService,
  listLocationsService,
  deleteLocationService,
  mapRunchiseLocation,
};

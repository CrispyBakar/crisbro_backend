const prisma = require("../lib/prisma");
const { Prisma } = require("@prisma/client");
const { parseDate, parseTime } = require("../utils/datetime");

class BannerError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = "BannerError";
  }
}

const bannerSelect = {
  banner_id: true,
  title: true,
  mime_type: true,
  status: true,
  type: true,
  start_date: true,
  end_date: true,
  start_time: true,
  end_time: true,
  redirect_type: true,
  url: true,
  created_at: true,
};

function withImageUrl(banner) {
  return { ...banner, image_url: `/api/banner/${banner.banner_id}/image` };
}

async function uploadBannerService(data) {
  const banner = await prisma.$transaction(async (tx) => {
    // Lock per transaksi supaya dua upload bersamaan tidak sama-sama lolos
    // pengecekan jumlah lalu membuat banner ke-4.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('banner_create'))`;

    const start_date = parseDate(data.start_date);
    const end_date = parseDate(data.end_date);
    const start_time = parseTime(data.start_time);
    const end_time = parseTime(data.end_time);

    return tx.banner.create({
      data: {
        title: data.title,
        image_data: data.image.buffer,
        mime_type: data.image.mime_type,
        status: data.status,
        type: data.type,
        start_date,
        end_date,
        start_time,
        end_time,
        redirect_type: data.redirect_type,
        url: data.url,
      },
      select: bannerSelect,
    });
  });

  return withImageUrl(banner);
}

async function editBannerService(bannerId, data) {
  const updateData = {};

  for (const field of ["title", "status", "type", "redirect_type", "url"]) {
    if (data[field] !== undefined) updateData[field] = data[field];
  }

  for (const field of ["start_date", "end_date"]) {
    if (data[field] !== undefined) {
      updateData[field] = parseDate(data[field])?.toISOString() ?? null;
    }
  }

  for (const field of ["start_time", "end_time"]) {
    if (data[field] !== undefined) {
      updateData[field] = parseTime(data[field]);
    }
  }

  if (data.image) {
    updateData.image_data = data.image.buffer;
    updateData.mime_type = data.image.mime_type;
  }

  try {
    const banner = await prisma.banner.update({
      where: { banner_id: bannerId },
      data: updateData,
      select: bannerSelect,
    });

    return withImageUrl(banner);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      throw new BannerError(404, "BANNER_NOT_FOUND", "Banner tidak ditemukan");
    }
    throw error;
  }
}

async function listBannersService() {
  const banners = await prisma.banner.findMany({
    select: bannerSelect,
    orderBy: [{ status: "desc" }, { created_at: "desc" }],
  });

  return banners.map(withImageUrl);
}

async function getBannerImageService(bannerId) {
  const banner = await prisma.banner.findUnique({
    where: { banner_id: bannerId },
    select: { image_data: true, mime_type: true },
  });

  if (!banner) {
    throw new BannerError(404, "BANNER_NOT_FOUND", "Banner tidak ditemukan");
  }

  return banner;
}

async function deleteBannerService(bannerId) {
  try {
    return await prisma.banner.delete({
      where: { banner_id: bannerId },
      select: bannerSelect,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      throw new BannerError(404, "BANNER_NOT_FOUND", "Banner tidak ditemukan");
    }
    throw error;
  }
}

async function clickBannerService({ bannerId, userId, userAgent, ipAddress }) {
  return prisma.bannerClicked.create({
    data: {
      banner_id: bannerId,
      user_id: userId,
      user_agent: userAgent,
      ip_address: ipAddress,
    },
    select: {
      banner_id: true,
      user_id: true,
      user_agent: true,
    },
  });
}

module.exports = {
  BannerError,
  uploadBannerService,
  editBannerService,
  listBannersService,
  getBannerImageService,
  deleteBannerService,
  clickBannerService,
};

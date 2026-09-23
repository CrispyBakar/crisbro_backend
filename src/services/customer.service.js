const prisma = require("../lib/prisma");
const { normalizePhone, phoneVariants } = require("../lib/phoneNumber");
const { withDbRetry } = require("../lib/dbRetry");
const {
  updateCustomer,
  getListCustomerPointHistory,
  activateCustomer,
  deactivateCustomer,
  generateAllCustomerHasPoint,
} = require("./runchise.service");
const { buildLocalCustomerData } = require("./auth.service");

const ALLOWED_SORT_FIELDS = ["created_at", "name", "phone_number", "status"];
const POINT_HISTORY_SORT_FIELDS = ["formatted_created_at", "issued_at_time"];
const ALLOWED_UPDATE_FIELDS = [
  "name",
  "phone_number",
  "email",
  "address",
  "province",
  "city",
  "country",
  "postal_code",
  "gender",
  "status",
  "last_updated_by_id",
  "owner_location_id",
  "dob",
];
const RUNCHISE_UPDATE_FIELDS = [
  "name",
  "phone_number",
  "address",
  "province",
  "city",
  "country",
  "postal_code",
  "gender",
  "status",
  "owner_location_id",
];

function sanitizeOrderBy(sort_by, sort_order) {
  const field = ALLOWED_SORT_FIELDS.includes(sort_by) ? sort_by : "created_at";
  const order = ["asc", "desc"].includes(sort_order) ? sort_order : "desc";
  return { [field]: order };
}

function sanitizePointHistoryOrderBy(sort_by, sort_order) {
  const field = POINT_HISTORY_SORT_FIELDS.includes(sort_by)
    ? sort_by
    : "formatted_created_at";
  const order = ["asc", "desc"].includes(sort_order) ? sort_order : "desc";
  return { [field]: order };
}

function pickAllowedFields(payload = {}, allowedFields) {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => allowedFields.includes(key)),
  );
}

async function listAllCustomers(query = {}) {
  const {
    page = 1,
    limit = 10,
    search = "",
    sort_by = "created_at",
    sort_order = "desc",
  } = query;

  const skip = (Number(page) - 1) * Number(limit);
  const take = Number(limit);

  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { phone_number: { contains: search, mode: "insensitive" } },
        ],
      }
    : {};

  try {
    const [customers, total] = await prisma.$transaction([
      prisma.customer.findMany({
        where,
        skip,
        take,
        orderBy: sanitizeOrderBy(sort_by, sort_order),
      }),
      prisma.customer.count({ where }),
    ]);

    return {
      data: customers,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        total_pages: Math.ceil(total / Number(limit)),
      },
    };
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function getCustomerById(customer_id) {
  if (!customer_id) throw new Error("customer_id is required");

  try {
    // Include email user & runchise_id lokasi owner untuk form edit customer
    const customer = await prisma.customer.findUnique({
      where: { customer_id: customer_id },
      include: {
        user: { select: { email: true } },
        owner_location: { select: { runchise_id: true, name: true } },
      },
    });

    return customer;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function getCustomerByUserId(user_id) {
  if (!user_id) throw new Error("user_id is required");

  try {
    const customer = await prisma.customer.findUnique({
      where: { user_id: user_id },
    });

    return customer;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function updateCustomerById(customer_id, payload) {
  // Email disimpan di tabel User, bukan Customer — dipisah sebelum update lokal
  const { email, ...data } = pickAllowedFields(payload, ALLOWED_UPDATE_FIELDS);
  const runchiseData = pickAllowedFields(data, RUNCHISE_UPDATE_FIELDS);

  if (!email && Object.keys(data).length === 0) {
    throw new Error("No valid fields to update");
  }

  try {
    // Find customer
    const customer = await prisma.customer.findUnique({
      where: { customer_id: customer_id },
      include: { user: { select: { email: true } } },
    });

    if (!customer) {
      throw new Error("Customer not found");
    }

    const currentPhone = normalizePhone(customer.phone_number);
    const nextPhone = normalizePhone(data.phone_number);
    const phoneChanged = Boolean(nextPhone && nextPhone !== currentPhone);

    if (phoneChanged) {
      const existingUser = await prisma.user.findFirst({
        where: {
          user_id: { not: customer.user_id },
          phone: { in: phoneVariants(nextPhone) },
        },
        select: { user_id: true },
      });

      if (existingUser) {
        throw new Error("Phone number is already registered");
      }

      data.phone_number = nextPhone;
      runchiseData.phone_number = nextPhone;
    }

    // Email hanya diupdate di tabel User ketika nilainya berubah; wajib unik
    const emailChanged = Boolean(email && email !== customer.user.email);

    if (emailChanged) {
      const existingUser = await prisma.user.findFirst({
        where: {
          user_id: { not: customer.user_id },
          email: email,
        },
        select: { user_id: true },
      });

      if (existingUser) {
        throw new Error("Email is already registered");
      }
    }

    if (data.owner_location_id !== undefined) {
      const runchiseLocationId = Number(data.owner_location_id);
      const location = Number.isInteger(runchiseLocationId)
        ? await prisma.location.findUnique({
            where: { runchise_id: runchiseLocationId },
            select: { location_id: true },
          })
        : null;

      if (!location) {
        throw new Error("Owner location not found");
      }

      // runchiseData tetap memakai runchise_id untuk API Runchise
      data.owner_location_id = location.location_id;
    }

    // Update on runchise database — hanya untuk field yang dikenal Runchise
    // (update email/dob saja tidak perlu menyentuh Runchise)
    if (Object.keys(runchiseData).length > 0) {
      if (!customer.runchise_id || !customer.runchise_location_id) {
        throw new Error(
          "Customer belum terhubung ke Runchise, tidak bisa update",
        );
      }

      await updateCustomer(
        customer.runchise_id,
        customer.runchise_location_id,
        runchiseData,
      );
    }

    let updated;
    try {
      if (phoneChanged || emailChanged) {
        updated = await prisma.$transaction(async (tx) => {
          const updatedCustomer =
            Object.keys(data).length > 0
              ? await tx.customer.update({
                  where: { customer_id: customer_id },
                  data,
                })
              : customer;

          const userData = {};
          if (phoneChanged) {
            Object.assign(userData, {
              phone: nextPhone,
              status: "inactive",
              phone_verified: false,
            });
          }
          if (emailChanged) {
            // Email baru menandai verifikasi email ulang
            Object.assign(userData, { email: email, email_verified: false });
          }

          await tx.user.update({
            where: { user_id: customer.user_id },
            data: userData,
          });

          return updatedCustomer;
        });
      } else {
        updated = await prisma.customer.update({
          where: { customer_id: customer_id },
          data,
        });
      }
    } catch (localError) {
      console.error(
        `CRITICAL: Runchise updated but local DB failed for customer_id=${customer_id}`,
        localError,
      );
      throw localError;
    }

    return updated;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function updateCustomerPointHistory(customer_id) {
  try {
    if (!customer_id) throw new Error("Customer ID must be required");

    const customer = await prisma.customer.findUnique({
      where: {
        customer_id: customer_id,
      },
    });

    if (!customer) throw new Error("Customer not found");

    const histories = await getListCustomerPointHistory(customer.runchise_id);

    if (histories.length === 0) return;

    // Insert histories yang belum ada, skip yang sudah ada via unique runchise_id
    const result = await prisma.customerPointHistory.createMany({
      data: histories.map((history) => ({
        customer_id: customer.customer_id,
        runchise_id: history.id,
        customer_point_id: history.customer_point_id,
        point_type: history.point_type,
        point_snapshot: history.point_snapshot,
        point: history.point,
        sale_transaction_uuid: history.sale_transaction_uuid,
        sale_transaction_id: history.sale_transaction_id,
        sales_return_id: history.sales_return_id,
        void_by: history.void_by,
        void_id: history.void_id,
        void_reason: history.void_reason ?? "",
        notes: history.notes ?? "",
        created_by_id: history.created_by_id,
        location_id: history.location_id,
        sales_no: history.sales_no != null ? String(history.sales_no) : null,
        expired_point: history.expired_point,
        expired_at: history.expired_at ? new Date(history.expired_at) : null,
        customer_expired_point_id: history.customer_expired_point_id,
        customer_order_uuid: history.customer_order_uuid,
        formatted_created_at: history.formatted_created_at
          ? new Date(history.formatted_created_at)
          : null,
        issued_at_time: history.issued_at_time
          ? new Date(history.issued_at_time)
          : null,
        point_type_description: history.point_type_description,
        channel: history.channel,
      })),
      skipDuplicates: true,
    });

    return result;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function listCustomerPointHistory(customer_id, query = {}) {
  if (!customer_id) throw new Error("customer_id is required");

  const {
    page = 1,
    limit = 10,
    point_type,
    sort_by = "formatted_created_at",
    sort_order = "desc",
  } = query;

  const skip = (Number(page) - 1) * Number(limit);
  const take = Number(limit);

  const where = { customer_id };
  if (point_type) {
    where.point_type = point_type;
  }

  try {
    const [histories, total] = await prisma.$transaction([
      prisma.customerPointHistory.findMany({
        where,
        skip,
        take,
        orderBy: sanitizePointHistoryOrderBy(sort_by, sort_order),
      }),
      prisma.customerPointHistory.count({ where }),
    ]);

    return {
      data: histories,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        total_pages: Math.ceil(total / Number(limit)),
      },
    };
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function changeStatusCustomer(customer_id, status) {
  try {
    const customer = await prisma.customer.findUnique({
      where: { customer_id: customer_id },
    });

    if (!customer) throw new Error("Customer not found.");

    if (!customer.runchise_id || !customer.runchise_location_id) {
      throw new Error(
        "Customer belum terhubung ke Runchise, tidak bisa update",
      );
    }

    // activateCustomer/deactivateCustomer memvalidasi payload object { status } via zod
    if (status === "active") {
      await activateCustomer(
        customer.runchise_id,
        customer.runchise_location_id,
        {
          status,
        },
      );
    } else {
      await deactivateCustomer(
        customer.runchise_id,
        customer.runchise_location_id,
        {
          status,
        },
      );
    }

    // Sinkronkan status ke DB lokal setelah Runchise berhasil
    return prisma.customer.update({
      where: { customer_id: customer_id },
      data: { status },
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function optionalDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function generateAllCustomerRunchise() {
  try {
    const customers = await generateAllCustomerHasPoint();

    const summary = {
      total_fetched: customers.length,
      created: 0,
      updated: 0,
      failed: 0,
      missing_location: 0,
      errors: [],
    };

    if (customers.length === 0) return summary;

    // Peta lokasi lokal berdasarkan runchise_id untuk mengisi FK
    // owner_location_id (runchise owner_location_id adalah id lokasi Runchise)
    const runchiseLocationIds = [
      ...new Set(
        customers
          .map((customer) => Number(customer.owner_location_id))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
    const locations = await prisma.location.findMany({
      where: { runchise_id: { in: runchiseLocationIds } },
      select: { location_id: true, runchise_id: true },
    });
    const locationIdByRunchiseId = new Map(
      locations.map((location) => [location.runchise_id, location.location_id]),
    );

    // Peta user berdasarkan varian nomor telepon untuk menghubungkan customer
    // baru ke akun user lokal yang sudah terdaftar (hanya user yang belum
    // memiliki record customer)
    const allPhoneVariants = [
      ...new Set(
        customers.flatMap((customer) =>
          phoneVariants(normalizePhone(customer.phone_number)),
        ),
      ),
    ];

    const userIdByPhone = new Map();
    if (allPhoneVariants.length > 0) {
      const users = await prisma.user.findMany({
        where: { phone: { in: allPhoneVariants } },
        select: {
          user_id: true,
          phone: true,
          customer: { select: { customer_id: true } },
        },
      });
      for (const user of users) {
        if (user.customer) continue;
        userIdByPhone.set(normalizePhone(user.phone), user.user_id);
      }
    }

    for (const customer of customers) {
      try {
        const runchiseLocationId = Number(customer.owner_location_id);
        const hasValidLocation =
          Number.isInteger(runchiseLocationId) && runchiseLocationId > 0;

        if (
          hasValidLocation &&
          !locationIdByRunchiseId.has(runchiseLocationId)
        ) {
          summary.missing_location++;
        }

        const normalizedPhone = normalizePhone(customer.phone_number) || null;
        const data = {
          runchise_location_id: hasValidLocation ? runchiseLocationId : null,
          owner_location_id: hasValidLocation
            ? (locationIdByRunchiseId.get(runchiseLocationId) ?? null)
            : null,
          name: customer.name,
          address: customer.address ?? null,
          province: customer.province ?? null,
          city: customer.city ?? null,
          country: customer.country ?? null,
          postal_code: customer.postal_code ?? null,
          dob: optionalDate(customer.dob) ?? null,
          gender: customer.gender ?? null,
          status: customer.status ?? null,
          balance: customer.balance ?? 0,
          member_since: optionalDate(customer.member_since) ?? null,
          total_point: customer.total_point ?? 0,
          available_point: customer.available_point ?? 0,
          runchise_synced_at: new Date(),
          created_at: new Date(customer.created_at ?? Date.now()),
          updated_at: new Date(customer.updated_at),
          // Nomor telepon hanya dioverwrite ketika Runchise mengirimkannya agar
          // customer yang terhubung user tidak kehilangan nomor lokalnya
          ...(customer.phone_number
            ? {
                phone_number: customer.phone_number,
                normalized_phone_number: normalizedPhone,
              }
            : {}),
        };

        // Customer dikenali lewat runchise_id; customer lokal milik user
        // terdaftar yang belum terhubung Runchise diadopsi lewat kecocokan
        // nomor telepon agar tidak terbentuk data ganda. Operasi dibungkus
        // withDbRetry karena koneksi pooler (Supavisor) sesekali terputus di
        // tengah loop panjang; retry aman karena blok ini idempoten.
        const existing = await withDbRetry(async () => {
          const byRunchiseId = await prisma.customer.findUnique({
            where: { runchise_id: customer.id },
            select: { customer_id: true },
          });
          if (byRunchiseId || !normalizedPhone) return byRunchiseId ?? null;

          return prisma.customer.findFirst({
            where: {
              runchise_id: null,
              OR: [
                { normalized_phone_number: normalizedPhone },
                { phone_number: { in: phoneVariants(normalizedPhone) } },
              ],
            },
            select: { customer_id: true },
            orderBy: { created_at: "asc" },
          });
        });

        if (existing) {
          await withDbRetry(() =>
            prisma.customer.update({
              where: { customer_id: existing.customer_id },
              data: { ...data, runchise_id: customer.id },
            }),
          );
          summary.updated++;
        } else {
          await withDbRetry(() =>
            prisma.customer.create({
              data: {
                ...data,
                runchise_id: customer.id,
                user_id: userIdByPhone.get(normalizedPhone) ?? null,
              },
            }),
          );
          summary.created++;
        }
      } catch (error) {
        // Satu customer gagal tidak menghentikan sinkronisasi sisanya
        summary.failed++;
        summary.errors.push({
          runchise_id: customer.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return summary;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

module.exports = {
  listAllCustomers,
  getCustomerById,
  getCustomerByUserId,
  updateCustomerById,
  updateCustomerPointHistory,
  listCustomerPointHistory,
  changeStatusCustomer,
  generateAllCustomerRunchise,
};

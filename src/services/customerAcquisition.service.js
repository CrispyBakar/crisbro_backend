const prisma = require("../lib/prisma");
const { Prisma } = require("@prisma/client");

class CustomerAcquisitionError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = "CustomerAcquisitionError";
  }
}

async function saveAcquisition(customer, { source, captured_via }) {
  if (!customer) {
    throw new CustomerAcquisitionError(
      404,
      "CUSTOMER_NOT_FOUND",
      "Customer tidak ditemukan",
    );
  }

  try {
    return await prisma.customerAcquisition.create({
      data: { customer_id: customer.customer_id, source, captured_via },
    });
  } catch (error) {
    // customer_id unik: satu customer hanya punya satu data akuisisi. Ditangkap
    // dari constraint, bukan dicek dulu, supaya dua request bersamaan tetap aman.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new CustomerAcquisitionError(
        409,
        "ACQUISITION_ALREADY_EXISTS",
        "Data akuisisi customer ini sudah tercatat",
      );
    }

    throw error;
  }
}

async function createCustomerAcquisition({ customer_id, ...acquisition }) {
  const customer = await prisma.customer.findUnique({
    where: { customer_id },
    select: { customer_id: true },
  });

  return saveAcquisition(customer, acquisition);
}

async function createMyCustomerAcquisition(user_id, acquisition) {
  if (!user_id) {
    throw new CustomerAcquisitionError(401, "UNAUTHENTICATED", "Unauthorized");
  }

  const customer = await prisma.customer.findUnique({
    where: { user_id },
    select: { customer_id: true },
  });

  return saveAcquisition(customer, acquisition);
}

// Customer yang tidak ada dan customer yang belum punya data akuisisi
// sama-sama 404, tetapi dibedakan lewat code dan pesannya.
async function getCustomerAcquisition(customer_id) {
  const customer = await prisma.customer.findUnique({
    where: { customer_id },
    select: { customer_id: true, customerAcquisition: true },
  });

  if (!customer) {
    throw new CustomerAcquisitionError(
      404,
      "CUSTOMER_NOT_FOUND",
      "Customer tidak ditemukan",
    );
  }

  if (!customer.customerAcquisition) {
    throw new CustomerAcquisitionError(
      404,
      "ACQUISITION_NOT_FOUND",
      "Data akuisisi customer ini belum tercatat",
    );
  }

  return customer.customerAcquisition;
}

module.exports = {
  getCustomerAcquisition,
  createCustomerAcquisition,
  createMyCustomerAcquisition,
  CustomerAcquisitionError,
};

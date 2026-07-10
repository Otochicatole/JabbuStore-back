import { ReviewSource, ReviewStatus } from "@prisma/client";
import { prisma } from "../src/shared/infrastructure/PrismaClient";

const legacyReviews = [
  {
    key: "brian-marchese-2025-07-17",
    name: "Brian Marchese",
    date: "2025-07-17T12:00:00.000Z",
    body: "Super recomendable y buena onda",
  },
  {
    key: "gaston-marino-2025-05-23",
    name: "Gastón Marino",
    date: "2025-05-23T12:00:00.000Z",
    body: "Le vendi una faka de 500usds, rápido y confiable.",
  },
  {
    key: "ramiro-moldes-2025-05-05",
    name: "Ramiro Moldes",
    date: "2025-05-05T12:00:00.000Z",
    body: "seguro y altoke gracias pa 😄",
  },
  {
    key: "luca-caporale-2025-04-22",
    name: "Luca Caporale",
    date: "2025-04-22T12:00:00.000Z",
    body: "Un crack, rapido, buena cotizacion, vendi por 800usd, super confiable.",
  },
  {
    key: "maxi-martinotti-2025-03-22",
    name: "Maxi Martinotti",
    date: "2025-03-22T12:00:00.000Z",
    body: "Tipazo, rápido y confiable",
  },
  {
    key: "lucio-raffo-2025-03-10",
    name: "Lucio Raffo",
    date: "2025-03-10T12:00:00.000Z",
    body: "+rep rapido y confiablee!",
  },
  {
    key: "francisco-alvarez-lamas-2025-03-05",
    name: "Francisco Alvarez Lamas",
    date: "2025-03-05T12:00:00.000Z",
    body: "+Rep . Rápido y buena atención!! 😎💪",
  },
  {
    key: "matii-gonzalez-2025-02-05",
    name: "Matii Gonzalez",
    date: "2025-02-05T12:00:00.000Z",
    body: "+rep a este crack, perfecta atencion",
  },
  {
    key: "feitan-gabis-2024-12-19",
    name: "Feitan Gabis",
    date: "2024-12-19T12:00:00.000Z",
    body: "+rep Le confie unos guantes de 1k y no me scameo, me salvo las deudas y las fiestas! Tipazo, encima madrugador",
  },
  {
    key: "ezequiel-iglesias-2024-11-01",
    name: "Ezequiel Iglesias",
    date: "2024-11-01T12:00:00.000Z",
    body: "+rep 100% confiable, Mariposa Case hardened vendida y todo recibido al instante!",
  },
  {
    key: "jaime-velasquez-2024-10-17",
    name: "Jaime Velasquez",
    date: "2024-10-17T12:00:00.000Z",
    body: "+Rep Un genio! Oferta increible y mucha confianza 💥💥",
  },
  {
    key: "julian-benitez-2024-07-31",
    name: "Julián Benítez",
    date: "2024-07-31T12:00:00.000Z",
    body: "+rep 100% profesional, toda la paciencia y sin vueltas. Vendí faka, guantes y AK, todo de 10.",
  },
];

async function main() {
  console.log("Seeding legacy home reviews...");

  for (const review of legacyReviews) {
    const email = `legacy-review-${review.key}@jabbustore.local`;
    const createdAt = new Date(review.date);

    const user = await prisma.user.upsert({
      where: { email },
      update: {
        name: review.name,
        isFake: true,
      },
      create: {
        email,
        name: review.name,
        isFake: true,
      },
    });

    await prisma.review.upsert({
      where: { legacyKey: review.key },
      update: {
        userId: user.id,
        body: review.body,
        status: ReviewStatus.APPROVED,
        source: ReviewSource.LEGACY,
        approvedAt: createdAt,
        rejectedAt: null,
        reviewedByAdminId: null,
        createdAt,
      },
      create: {
        userId: user.id,
        body: review.body,
        status: ReviewStatus.APPROVED,
        source: ReviewSource.LEGACY,
        legacyKey: review.key,
        approvedAt: createdAt,
        createdAt,
      },
    });
  }

  console.log(`Seeded ${legacyReviews.length} legacy reviews.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

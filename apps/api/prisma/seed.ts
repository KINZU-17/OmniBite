/**
 * Dev seed: one location, two tables (with QR tokens), a small menu with
 * modifiers + allergens, and one staff member per role. Prints the QR tokens and
 * staff ids to drive the diner PWA and KDS locally. Destructive — dev only.
 */
import { PrismaClient, StaffRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function wipe() {
  // Children first to respect FKs.
  await prisma.auditLog.deleteMany();
  await prisma.etimsInvoiceLine.deleteMany();
  await prisma.storeCredit.deleteMany();
  await prisma.refund.deleteMany();
  await prisma.etimsInvoice.deleteMany();
  await prisma.kitchenTicketLine.deleteMany();
  await prisma.kitchenTicket.deleteMany();
  await prisma.mpesaTransaction.deleteMany();
  await prisma.cardTransaction.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.roundItemModifier.deleteMany();
  await prisma.roundItem.deleteMany();
  await prisma.round.deleteMany();
  await prisma.sessionParticipant.deleteMany();
  await prisma.restaurantTable.updateMany({ data: { currentSessionId: null } });
  await prisma.tableSession.deleteMany();
  await prisma.menuItemModifierGroup.deleteMany();
  await prisma.menuItemAllergen.deleteMany();
  await prisma.modifier.deleteMany();
  await prisma.modifierGroup.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.cashDrawerSession.deleteMany();
  await prisma.mpesaReconciliationRun.deleteMany();
  await prisma.restaurantTable.deleteMany();
  await prisma.staff.deleteMany();
  await prisma.location.deleteMany();
}

async function main() {
  await wipe();

  const location = await prisma.location.create({
    data: {
      groupId: randomUUID(),
      name: 'OmniBite Westlands',
      kraPin: 'P051234567A',
      mpesaShortcode: '174379',
    },
  });

  const pin = await bcrypt.hash('1234', 10);
  const roles: StaffRole[] = ['ADMIN', 'MANAGER', 'SERVER', 'KITCHEN'];
  const staff = await Promise.all(
    roles.map((role) =>
      prisma.staff.create({
        data: { locationId: location.id, name: `${role[0]}${role.slice(1).toLowerCase()} Demo`, role, pinHash: pin },
      }),
    ),
  );

  const tables = await Promise.all(
    ['1', '2'].map((n) =>
      prisma.restaurantTable.create({
        data: { locationId: location.id, tableNumber: n, qrToken: `demo-qr-${n}-${randomUUID().slice(0, 8)}` },
      }),
    ),
  );

  const size = await prisma.modifierGroup.create({
    data: {
      name: 'Size',
      minSelect: 1,
      maxSelect: 1,
      modifiers: { create: [{ name: 'Regular', priceDelta: 0 }, { name: 'Large', priceDelta: 150 }] },
    },
    include: { modifiers: true },
  });
  const extras = await prisma.modifierGroup.create({
    data: {
      name: 'Extras',
      minSelect: 0,
      maxSelect: 3,
      modifiers: { create: [{ name: 'Extra cheese', priceDelta: 80 }, { name: 'No onions', priceDelta: 0 }] },
    },
  });

  const items: Array<{ name: string; category: string; price: number; code: string; allergens: string[] }> = [
    { name: 'Beef Burger', category: 'Grill', price: 850, code: 'KE-FOOD-0001', allergens: ['gluten', 'dairy'] },
    { name: 'Grilled Chicken', category: 'Grill', price: 950, code: 'KE-FOOD-0002', allergens: [] },
    { name: 'Fries', category: 'Fry', price: 350, code: 'KE-FOOD-0003', allergens: [] },
    { name: 'Garden Salad', category: 'Cold', price: 600, code: 'KE-FOOD-0004', allergens: [] },
    { name: 'Soda', category: 'Cold', price: 200, code: 'KE-DRINK-0001', allergens: [] },
  ];

  for (const it of items) {
    const created = await prisma.menuItem.create({
      data: {
        locationId: location.id,
        name: it.name,
        category: it.category,
        basePrice: it.price,
        itemCode: it.code,
        description: `${it.name} — freshly prepared`,
        allergens: { create: it.allergens.map((a) => ({ allergen: a })) },
      },
    });
    // Attach modifier groups to the mains.
    if (it.category === 'Grill') {
      await prisma.menuItemModifierGroup.createMany({
        data: [
          { menuItemId: created.id, modifierGroupId: size.id },
          { menuItemId: created.id, modifierGroupId: extras.id },
        ],
      });
    }
  }

  console.log('\nSeed complete.');
  console.log('Location:', location.id, '-', location.name);
  console.log('Tables  :', tables.map((t) => `#${t.tableNumber} qr=${t.qrToken}`).join('  '));
  console.log('Staff   :', staff.map((s) => `${s.role}=${s.id}`).join('  '));
  console.log('Staff PIN: 1234\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

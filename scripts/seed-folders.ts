import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ADMIN_USER_ID = 'cmhnuilov0000ju04yxn0cmqz';

// Existing bank IDs
const BANKS = {
  coreRecall:       'cmhnujd6y0002ju04ai97kxer', // 1 Core Technical Recall
  techBase:         'cmhnujogj000oju04ddiltidn', // 2 Technical Base
  collaboration:    'cmhnulcxn001aju04d8jcc1o4', // 3 Technical Collaboration
  roleSpecific:     'cmhnulvbl001wju041p1uc3qx', // 4 Role Specific Focus
  leadership:       'cmhnum667002iju04njmvyqrd', // 5 Technical Leadership
  communication:    'cmhnumeh00034ju04k9cx26gy', // 6 Interview Communication
  perfAccessib:     'cmhnumnuk003qju04mb5tiaxu', // 7 Performance Accessibility
  attio:            'cmlgmyxn10003l504nkuhtmnd', // Attio Interview Prep
  bridgeRound:      'cmkr7gld70001ic04j0sbzxv3', // bridge round logic
  businessModel:    'cmkr7glei0007ic04tula7gen', // business model
  founderStory:     'cmkr7glf6000hic04zxy2u161', // founder story compression
  founderVision:    'cmkr7glfq000nic04ufxbckxs', // founder vision
  fundraisingNarr:  'cmkr7glgf000vic04no4acy7t', // fundraising narrative
  objectionHandl:   'cmkr7glh30017ic04ff66zhn1', // objection handling
  productSystem:    'cmkr7glhq001eic04ni4zxiet', // product system
};

const folders = [
  {
    title: 'Full Stack Engineering',
    color: '#6366f1',
    order: 0,
    banks: [BANKS.coreRecall, BANKS.techBase],
  },
  {
    title: 'Frontend & Design Engineering',
    color: '#ec4899',
    order: 1,
    banks: [BANKS.perfAccessib, BANKS.roleSpecific],
  },
  {
    title: 'Leadership & Collaboration',
    color: '#f59e0b',
    order: 2,
    banks: [BANKS.collaboration, BANKS.leadership, BANKS.communication],
  },
  {
    title: 'Company Prep',
    color: '#10b981',
    order: 3,
    banks: [BANKS.attio],
  },
  {
    title: 'Fundraising & Founder',
    color: '#8b5cf6',
    order: 4,
    banks: [
      BANKS.bridgeRound,
      BANKS.businessModel,
      BANKS.founderStory,
      BANKS.founderVision,
      BANKS.fundraisingNarr,
      BANKS.objectionHandl,
      BANKS.productSystem,
    ],
  },
];

async function main() {
  console.log('Creating folders...');

  for (const folder of folders) {
    const { banks, ...folderData } = folder;

    const created = await prisma.bankFolder.create({
      data: {
        ...folderData,
        userId: ADMIN_USER_ID,
        items: {
          create: banks.map((bankId, index) => ({
            bankId,
            order: index,
          })),
        },
      },
    });

    console.log(`✓ Created folder: ${created.title} (${banks.length} banks)`);
  }

  console.log('\nDone.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

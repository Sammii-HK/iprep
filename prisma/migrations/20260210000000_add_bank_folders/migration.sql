-- AlterTable: Add order column to QuestionBank
ALTER TABLE "QuestionBank" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: BankFolder
CREATE TABLE "BankFolder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "color" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BankFolderItem
CREATE TABLE "BankFolderItem" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BankFolderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankFolder_userId_order_idx" ON "BankFolder"("userId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "BankFolderItem_folderId_bankId_key" ON "BankFolderItem"("folderId", "bankId");

-- CreateIndex
CREATE INDEX "BankFolderItem_folderId_order_idx" ON "BankFolderItem"("folderId", "order");

-- CreateIndex
CREATE INDEX "BankFolderItem_bankId_idx" ON "BankFolderItem"("bankId");

-- AddForeignKey
ALTER TABLE "BankFolder" ADD CONSTRAINT "BankFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankFolderItem" ADD CONSTRAINT "BankFolderItem_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "BankFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankFolderItem" ADD CONSTRAINT "BankFolderItem_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "QuestionBank"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: Assign sequential order to existing banks per user
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt" DESC) - 1 AS new_order
  FROM "QuestionBank"
)
UPDATE "QuestionBank" SET "order" = ranked.new_order
FROM ranked WHERE "QuestionBank".id = ranked.id;

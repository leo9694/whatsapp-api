const prisma = require("../src/database/prisma");
const { Prisma } = require("@prisma/client");
const templateService = require("../src/services/template.service");

async function main() {
  const messages = await prisma.message.findMany({
    where: {
      type: { equals: "template", mode: "insensitive" },
      templateName: { not: null },
      templateData: { equals: Prisma.DbNull },
    },
    select: {
      id: true,
      templateName: true,
      templateLanguage: true,
      templateComponents: true,
    },
  });

  let updated = 0;
  let skipped = 0;
  for (const message of messages) {
    try {
      const found = await templateService.findTemplate(message.templateName, message.templateLanguage || undefined);
      const rendered = templateService.renderTemplate(found.template, message.templateComponents || []);
      await prisma.message.update({
        where: { id: message.id },
        data: {
          templateData: rendered,
          renderedText: rendered.body || null,
          text: rendered.body || rendered.header || message.templateName,
        },
      });
      updated += 1;
    } catch {
      skipped += 1;
    }
  }
  console.log(JSON.stringify({ event: "template_history_backfill", found: messages.length, updated, skipped }));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ event: "template_history_backfill_failed", message: error.message }));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handleApiError, NotFoundError, ValidationError } from "@/lib/errors";
import { jsPDF } from "jspdf";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      throw new ValidationError("sessionId is required");
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        bank: true,
        items: {
          include: { question: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!session) {
      throw new NotFoundError("Session", sessionId);
    }

    if (session.userId !== user.id && user.role !== "ADMIN") {
      throw new ValidationError("You do not have access to this session");
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    let y = 20;

    const checkPageBreak = (needed: number) => {
      if (y + needed > doc.internal.pageSize.getHeight() - 20) {
        doc.addPage();
        y = 20;
      }
    };

    // Title
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text("iPrep Practice Report", margin, y);
    y += 10;

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text(`Session: ${session.title}`, margin, y);
    y += 6;
    doc.text(`Bank: ${session.bank?.title || "N/A"}`, margin, y);
    y += 6;
    doc.text(
      `Date: ${new Date(session.createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}`,
      margin,
      y
    );
    y += 6;
    doc.text(`Questions answered: ${session.items.length}`, margin, y);
    y += 12;

    // Overall Scores
    if (session.items.length > 0) {
      const avg = (key: string) => {
        const vals = session.items
          .map((item) => (item as Record<string, unknown>)[key])
          .filter((v): v is number => typeof v === "number");
        return vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      };

      const scores = [
        { label: "Answer Quality", value: avg("answerQuality") },
        { label: "STAR Structure", value: avg("starScore") },
        { label: "Impact", value: avg("impactScore") },
        { label: "Clarity", value: avg("clarityScore") },
        { label: "Confidence", value: avg("confidenceScore") },
        { label: "Intonation", value: avg("intonationScore") },
        { label: "Technical Accuracy", value: avg("technicalAccuracy") },
        { label: "Terminology", value: avg("terminologyUsage") },
      ];

      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("Overall Scores", margin, y);
      y += 8;

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");

      scores.forEach((score) => {
        if (score.value !== null) {
          const scoreText = `${score.label}: ${score.value.toFixed(1)}/5`;
          // Draw a simple score bar
          doc.text(scoreText, margin, y);
          const barX = margin + 60;
          const barWidth = contentWidth - 65;
          doc.setDrawColor(200, 200, 200);
          doc.setFillColor(200, 200, 200);
          doc.roundedRect(barX, y - 3, barWidth, 4, 1, 1, "F");
          const fillWidth = (score.value / 5) * barWidth;
          if (score.value >= 3.5) {
            doc.setFillColor(34, 197, 94); // green
          } else if (score.value >= 2) {
            doc.setFillColor(234, 179, 8); // yellow
          } else {
            doc.setFillColor(239, 68, 68); // red
          }
          doc.roundedRect(barX, y - 3, fillWidth, 4, 1, 1, "F");
          y += 7;
        }
      });

      // Delivery metrics
      y += 5;
      const totalWords = session.items.reduce((sum, item) => sum + (item.words || 0), 0);
      const totalFillers = session.items.reduce(
        (sum, item) => sum + (item.fillerCount || 0),
        0
      );
      const avgWPM = avg("wpm");

      doc.setFontSize(10);
      doc.text(
        `Delivery: ${totalWords} total words | ${totalFillers} filler words | Avg ${
          avgWPM ? Math.round(avgWPM) : "N/A"
        } WPM`,
        margin,
        y
      );
      y += 12;
    }

    // Per-question Details
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    checkPageBreak(20);
    doc.text("Question-by-Question Review", margin, y);
    y += 10;

    session.items.forEach((item, idx) => {
      checkPageBreak(50);

      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      const questionText = item.question?.text || "Unknown question";
      const wrappedQ = doc.splitTextToSize(
        `Q${idx + 1}: ${questionText}`,
        contentWidth
      );
      doc.text(wrappedQ, margin, y);
      y += wrappedQ.length * 5 + 2;

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");

      // Scores row
      const scoreItems = [
        item.answerQuality != null ? `Quality: ${item.answerQuality}/5` : null,
        item.starScore != null ? `STAR: ${item.starScore}/5` : null,
        item.impactScore != null ? `Impact: ${item.impactScore}/5` : null,
        item.clarityScore != null ? `Clarity: ${item.clarityScore}/5` : null,
        item.confidenceScore != null ? `Confidence: ${item.confidenceScore}/5` : null,
      ].filter(Boolean);

      if (scoreItems.length > 0) {
        doc.text(scoreItems.join("  |  "), margin, y);
        y += 5;
      }

      // Metrics
      const metricsLine = [
        item.words != null ? `${item.words} words` : null,
        item.wpm != null ? `${item.wpm} WPM` : null,
        item.fillerCount != null ? `${item.fillerCount} fillers` : null,
      ]
        .filter(Boolean)
        .join("  |  ");

      if (metricsLine) {
        doc.text(metricsLine, margin, y);
        y += 5;
      }

      // Transcript excerpt
      if (item.transcript) {
        checkPageBreak(15);
        doc.setFont("helvetica", "italic");
        const excerpt = item.transcript.substring(0, 200) + (item.transcript.length > 200 ? "..." : "");
        const wrappedT = doc.splitTextToSize(`"${excerpt}"`, contentWidth);
        doc.text(wrappedT, margin, y);
        y += wrappedT.length * 4 + 2;
      }

      // What was right
      if (item.whatWasRight && item.whatWasRight.length > 0) {
        checkPageBreak(10);
        doc.setFont("helvetica", "bold");
        doc.text("Strengths:", margin, y);
        y += 4;
        doc.setFont("helvetica", "normal");
        item.whatWasRight.slice(0, 3).forEach((point) => {
          const wrapped = doc.splitTextToSize(`  + ${point}`, contentWidth);
          checkPageBreak(wrapped.length * 4);
          doc.text(wrapped, margin, y);
          y += wrapped.length * 4;
        });
        y += 2;
      }

      // Don't forget
      const dontForget = (item as unknown as { dontForget: string[] }).dontForget;
      if (dontForget && dontForget.length > 0) {
        checkPageBreak(10);
        doc.setFont("helvetica", "bold");
        doc.text("Key points missed:", margin, y);
        y += 4;
        doc.setFont("helvetica", "normal");
        dontForget.slice(0, 3).forEach((point) => {
          const wrapped = doc.splitTextToSize(`  - ${point}`, contentWidth);
          checkPageBreak(wrapped.length * 4);
          doc.text(wrapped, margin, y);
          y += wrapped.length * 4;
        });
        y += 2;
      }

      // Tips
      if (item.aiFeedback) {
        checkPageBreak(10);
        doc.setFont("helvetica", "bold");
        doc.text("Tips:", margin, y);
        y += 4;
        doc.setFont("helvetica", "normal");
        item.aiFeedback
          .split(" | ")
          .slice(0, 2)
          .forEach((tip) => {
            const wrapped = doc.splitTextToSize(`  * ${tip}`, contentWidth);
            checkPageBreak(wrapped.length * 4);
            doc.text(wrapped, margin, y);
            y += wrapped.length * 4;
          });
      }

      y += 8;
    });

    // Footer
    checkPageBreak(15);
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(150, 150, 150);
    doc.text("Generated by iPrep - AI-powered practice platform", margin, y);

    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="iprep-report-${session.title
          .replace(/[^a-zA-Z0-9]/g, "-")
          .substring(0, 40)}.pdf"`,
      },
    });
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code },
      { status: errorData.statusCode }
    );
  }
}

import { jsPDF } from "jspdf";
import { formatCents } from "./money.js";
import { toDate, toISODate } from "./date.jsx";

const fmtDate = (d) => {
  try {
    return toDate(d).toLocaleDateString("pt-BR");
  } catch {
    return "";
  }
};

const splitText = (doc, text, maxWidth) =>
  doc.splitTextToSize(String(text || ""), maxWidth);

const ensureSpace = (doc, y, needed, pageH, margin) => {
  if (y + needed > pageH - margin) {
    doc.addPage();
    return margin;
  }
  return y;
};

const drawWrappedLine = (doc, text, x, y, maxWidth, lineGap) => {
  const lines = splitText(doc, text, maxWidth);
  lines.forEach((ln, i) => {
    doc.text(ln, x, y + i * lineGap);
  });
  return y + lines.length * lineGap;
};

const drawList = (doc, items, x, y, maxWidth, pageH, margin) => {
  const lineGap = 14;
  items.forEach((item) => {
    const line = `${fmtDate(item.date)} - ${formatCents(item.amount_cents)} | ${item.label}`;
    const lines = splitText(doc, line, maxWidth - 12);
    const itemHeight = Math.max(1, lines.length) * lineGap;
    y = ensureSpace(doc, y, itemHeight, pageH, margin);
    doc.text("-", x, y);
    lines.forEach((ln, i) => {
      doc.text(ln, x + 12, y + i * lineGap);
    });
    y += itemHeight;
  });
  return y;
};

export function gerarPdfRelatorioSemanal({
  periodStart,
  periodEnd,
  weekStart,
  weekEnd,
  openingCents,
  entradas = [],
  saidas = [],
  saldoFinalCents,
}) {
  const rangeStart = periodStart || weekStart;
  const rangeEnd = periodEnd || weekEnd;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  let y = 50;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Relatorio por Periodo", pageW / 2, y, { align: "center" });
  y += 24;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  y = drawWrappedLine(
    doc,
    `Registro do Periodo: ${fmtDate(rangeStart)} a ${fmtDate(rangeEnd)}`,
    margin,
    y,
    pageW - margin * 2,
    14
  );
  y += 6;

  y = drawWrappedLine(
    doc,
    `Saldo Inicial do Periodo: ${formatCents(openingCents)}`,
    margin,
    y,
    pageW - margin * 2,
    14
  );
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.text("Entradas:", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");

  if (!entradas.length) {
    y = ensureSpace(doc, y, 14, pageH, margin);
    doc.text("- Sem entradas no periodo", margin, y);
    y += 14;
  } else {
    y = drawList(doc, entradas, margin, y, pageW - margin * 2, pageH, margin);
  }

  y += 6;
  y = ensureSpace(doc, y, 18, pageH, margin);
  doc.setFont("helvetica", "bold");
  doc.text("Saidas:", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");

  if (!saidas.length) {
    y = ensureSpace(doc, y, 14, pageH, margin);
    doc.text("- Sem saidas no periodo", margin, y);
    y += 14;
  } else {
    y = drawList(doc, saidas, margin, y, pageW - margin * 2, pageH, margin);
  }

  y += 8;
  y = ensureSpace(doc, y, 16, pageH, margin);
  doc.setFont("helvetica", "bold");
  doc.text(`Saldo Final do Periodo: ${formatCents(saldoFinalCents)}`, margin, y);

  const periodStartISO = toISODate(rangeStart);
  const periodEndISO = toISODate(rangeEnd);
  const fileName = `Relatorio_Periodo_${periodStartISO}_a_${periodEndISO}.pdf`;
  const blob = doc.output("blob");
  return { blob, fileName };
}

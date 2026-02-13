const pptxgen = require("pptxgenjs");
const fs = require("fs");
const path = require("path");

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "CI/CD PoC";
pres.title = "Fargate Infrastructure Architecture";

// Ocean Gradient palette (from skill design ideas)
const COLORS = {
  primary: "065A82",    // deep blue
  secondary: "1C7293",  // teal
  accent: "21295C",     // midnight
  light: "E8F4F8",      // ice
  white: "FFFFFF",
  textDark: "1E293B",
  textMuted: "64748B",
};

const slides = [
  { file: "fargate-01-infrastructure-overview", title: "High-Level Infrastructure Overview" },
  { file: "fargate-02-deployment-model", title: "Deployment Model (Two-Tier Architecture)" },
  { file: "fargate-03-cicd-pipeline", title: "CI/CD Pipeline Flow (8 Stages)" },
  { file: "fargate-04-request-flow", title: "Request Flow" },
  { file: "fargate-05-security-groups", title: "Security Groups Chain" },
  { file: "fargate-06-alb-routing", title: "ALB Path-Based Routing" },
  { file: "fargate-07-ecs-deployment", title: "ECS Deployment Strategy" },
  { file: "fargate-08-monitoring", title: "Monitoring & Observability" },
  { file: "fargate-09-webhook", title: "Webhook Integration (Azure DevOps → AWS)" },
];


// --- Title Slide (dark background) ---
const titleSlide = pres.addSlide();
titleSlide.background = { color: COLORS.accent };

// Top accent bar
titleSlide.addShape(pres.shapes.RECTANGLE, {
  x: 0, y: 0, w: 10, h: 0.06, fill: { color: COLORS.secondary },
});

titleSlide.addText("FARGATE", {
  x: 0.8, y: 1.2, w: 8.4, h: 0.8,
  fontSize: 14, fontFace: "Trebuchet MS", color: COLORS.secondary,
  charSpacing: 6, bold: true, margin: 0,
});

titleSlide.addText("Infrastructure Architecture", {
  x: 0.8, y: 1.8, w: 8.4, h: 1.2,
  fontSize: 40, fontFace: "Trebuchet MS", color: COLORS.white,
  bold: true, margin: 0,
});

titleSlide.addText("CI/CD Proof of Concept — AWS ECS Fargate", {
  x: 0.8, y: 3.2, w: 8.4, h: 0.6,
  fontSize: 16, fontFace: "Calibri", color: COLORS.textMuted,
  margin: 0,
});

// Bottom bar
titleSlide.addShape(pres.shapes.RECTANGLE, {
  x: 0, y: 5.1, w: 10, h: 0.525, fill: { color: COLORS.primary },
});
titleSlide.addText("9 Architecture Diagrams", {
  x: 0.8, y: 5.1, w: 8.4, h: 0.525,
  fontSize: 12, fontFace: "Calibri", color: COLORS.white,
  valign: "middle", margin: 0,
});

// --- Diagram Slides ---
slides.forEach((s, i) => {
  const slide = pres.addSlide();
  slide.background = { color: COLORS.light };

  // Top colored strip
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.06, fill: { color: COLORS.primary },
  });

  // Slide number pill
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 0.25, w: 0.45, h: 0.35, fill: { color: COLORS.primary },
    rectRadius: 0.02,
  });
  slide.addText(String(i + 1).padStart(2, "0"), {
    x: 0.5, y: 0.25, w: 0.45, h: 0.35,
    fontSize: 11, fontFace: "Consolas", color: COLORS.white,
    align: "center", valign: "middle", margin: 0,
  });

  // Title
  slide.addText(s.title, {
    x: 1.1, y: 0.2, w: 8.4, h: 0.45,
    fontSize: 20, fontFace: "Trebuchet MS", color: COLORS.accent,
    bold: true, margin: 0,
  });

  // Diagram image — centered, max area
  const imgPath = path.resolve(__dirname, `../docs/diagrams/images/${s.file}.png`);
  if (fs.existsSync(imgPath)) {
    slide.addImage({
      path: imgPath,
      x: 0.5, y: 0.85, w: 9.0, h: 4.4,
      sizing: { type: "contain", w: 9.0, h: 4.4 },
    });
  }

  // Footer
  slide.addText(`Fargate — ${s.title}`, {
    x: 0.5, y: 5.25, w: 7, h: 0.3,
    fontSize: 9, fontFace: "Calibri", color: COLORS.textMuted,
    margin: 0,
  });
  slide.addText(`${i + 1} / ${slides.length}`, {
    x: 8.5, y: 5.25, w: 1, h: 0.3,
    fontSize: 9, fontFace: "Calibri", color: COLORS.textMuted,
    align: "right", margin: 0,
  });
});

// --- Write file ---
const outPath = path.resolve(__dirname, "../fargate-architecture.pptx");
pres.writeFile({ fileName: outPath }).then(() => {
  console.log("Created: " + outPath);
});

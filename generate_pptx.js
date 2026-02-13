const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';
pres.author = 'Antigravity';
pres.title = 'Fargate Infrastructure Architecture';

// Theme - Midnight Executive
const colors = {
  bg: "1E2761",       // Navy Background
  primary: "CADCFC",  // Ice Blue
  accent: "FFFFFF",   // White
  highlight: "F96167",// Coral
  muted: "7B8FA1",    // Muted Blue/Grey
  success: "97BC62",  // Green
  container: "283A5E",// Lighter Navy
  box: "3E5074",      // Box Fill
  line: "CADCFC"      // Line Color
};

// Styles
const textStyles = {
  title: { fontSize: 24, fontFace: "Arial", color: colors.accent, bold: true, align: "left" },
  subtitle: { fontSize: 14, fontFace: "Segoe UI", color: colors.primary, align: "left" },
  label: { fontSize: 9, fontFace: "Segoe UI", color: colors.accent, align: "center", bold: true },
  detail: { fontSize: 7, fontFace: "Segoe UI", color: colors.primary, align: "center" },
  tiny: { fontSize: 6, fontFace: "Segoe UI", color: colors.muted, align: "center" }
};

// Helper: Draw Arrow
function drawArrow(slide, x, y, w, h, dir = 'right', label = "") {
  let shape = pres.shapes.RIGHT_ARROW;
  if (dir === 'down') shape = pres.shapes.DOWN_ARROW;
  if (dir === 'left') shape = pres.shapes.LEFT_ARROW;
  if (dir === 'up') shape = pres.shapes.UP_ARROW;

  slide.addShape(shape, { x: x, y: y, w: w, h: h, fill: { color: colors.muted } });
  if (label) {
    let lx = x;
    let ly = y - 0.15;
    if (dir === 'down') { lx = x + 0.1; ly = y; }
    slide.addText(label, { x: lx, y: ly, w: w, h: 0.2, ...textStyles.tiny });
  }
}

// Helper: Draw Line
function drawLine(slide, x, y, w, h, color = colors.muted, dash = false) {
  slide.addShape(pres.shapes.LINE, {
    x: x, y: y, w: w, h: h,
    line: { color: color, width: 1, dashType: dash ? 'dash' : 'solid' }
  });
}


// Helper: Draw Detailed Box
function drawBox(slide, title, details, x, y, w, h, color = colors.box) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: x, y: y, w: w, h: h,
    fill: { color: color },
    line: { color: colors.primary, width: 0.5 },
    rectRadius: 0.05
  });
  slide.addText(title, { x: x, y: y + 0.05, w: w, h: 0.2, ...textStyles.label });
  if (details) {
    slide.addText(details, { x: x + 0.05, y: y + 0.3, w: w - 0.1, h: h - 0.3, ...textStyles.detail, valign: 'top' });
  }
}

// Helper: Draw Container/Subgraph
function drawContainer(slide, label, x, y, w, h) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: x, y: y, w: w, h: h,
    fill: { color: colors.container, transparency: 60 },
    line: { color: colors.muted, width: 1, dashType: 'dash' },
    rectRadius: 0.1
  });
  slide.addText(label, { x: x, y: y + 0.05, w: w, h: 0.2, fontSize: 8, color: colors.muted, align: "left", bold: true, margin: 5 });
}

function addSlideTitle(slide, title) {
  slide.background = { color: colors.bg };
  slide.addText(title, { x: 0.5, y: 0.2, w: 9, h: 0.5, ...textStyles.title });
}

// --- SLIDES ---

// 1. Fargate - High-Level Infrastructure Overview
let slide1 = pres.addSlide();
addSlideTitle(slide1, "1. High-Level Infrastructure Overview");

// Internet
drawContainer(slide1, "Internet", 0.2, 1.0, 1.5, 3.0);
drawBox(slide1, "Client / Browser", "", 0.3, 1.3, 1.3, 0.6);
drawBox(slide1, "Azure DevOps", "Git Repos", 0.3, 2.3, 1.3, 0.6);

// AWS Cloud
drawContainer(slide1, "AWS Cloud (us-east-1)", 1.8, 0.8, 8.0, 4.5);

// API Gateway
drawContainer(slide1, "API Gateway", 2.0, 1.2, 1.5, 1.5);
drawBox(slide1, "HTTP API", "HTTPS + TLS 1.2+", 2.1, 1.5, 1.3, 0.5);
drawBox(slide1, "Webhook Lambda", "POST /webhook", 2.1, 2.1, 1.3, 0.5);

// VPC
drawContainer(slide1, "VPC 10.0.0.0/16", 3.6, 1.0, 6.1, 4.2);

// VPC Link
drawBox(slide1, "VPC Link", "Private Access", 3.8, 1.5, 1.0, 0.6);

// ALB
drawContainer(slide1, "Load Balancing", 5.0, 1.2, 1.2, 1.0);
drawBox(slide1, "Internal ALB", "HTTP :80", 5.1, 1.5, 1.0, 0.6);

// Projects
drawContainer(slide1, "Project A: cash", 6.3, 1.2, 1.5, 1.8);
drawBox(slide1, "TG A", "/api/cash", 6.4, 1.5, 1.3, 0.4);
drawBox(slide1, "SVC A", "Fargate", 6.4, 2.0, 1.3, 0.4);
drawBox(slide1, "Pipeline A", "8 stages", 6.4, 2.5, 1.3, 0.4, colors.highlight);

drawContainer(slide1, "Project B: poultry", 8.0, 1.2, 1.5, 1.8);
drawBox(slide1, "TG B", "/api/poultry", 8.1, 1.5, 1.3, 0.4);
drawBox(slide1, "SVC B", "Fargate", 8.1, 2.0, 1.3, 0.4);
drawBox(slide1, "Pipeline B", "8 stages", 8.1, 2.5, 1.3, 0.4, colors.highlight);

// AZs (Simplified visual at bottom of VPC)
drawContainer(slide1, "AZ-a (10.0.1.0/24, 10.0.10.0/24)", 3.8, 3.5, 2.8, 0.8);
drawContainer(slide1, "AZ-b (10.0.2.0/24, 10.0.11.0/24)", 6.8, 3.5, 2.8, 0.8);

// Connectors
drawArrow(slide1, 1.6, 1.6, 0.4, 0.1); // Client -> APIGW
drawArrow(slide1, 3.5, 1.8, 0.3, 0.1); // APIGW -> VpcLink
drawArrow(slide1, 4.8, 1.8, 0.2, 0.1); // VpcLink -> ALB
drawArrow(slide1, 6.1, 1.8, 0.2, 0.1); // ALB -> TG (abstract)


// 2. Fargate - Deployment Model
let slide2 = pres.addSlide();
addSlideTitle(slide2, "2. Deployment Model (Two-Tier Architecture)");

// Shared Infra
drawContainer(slide2, "Shared Infrastructure (deploy.sh)", 0.5, 1.0, 4.0, 4.0);
drawBox(slide2, "main.yaml", "Root Stack", 1.8, 1.3, 1.4, 0.6, colors.highlight);

const sharedStacks = ["VPC", "SecurityGroups", "IAM", "ALB", "ApiGateway", "ECS Cluster", "Monitoring"];
sharedStacks.forEach((stack, i) => {
  let y = 2.2 + (Math.floor(i / 2) * 0.8);
  let x = 0.7 + ((i % 2) * 1.8);
  drawBox(slide2, stack, "", x, y, 1.6, 0.6);
  drawArrow(slide2, 2.5, 1.9, 0, 0.3, "down"); // Abstract connection
});

// Exports
drawContainer(slide2, "Fargate Exports (Fn::ImportValue)", 5.0, 1.0, 2.0, 4.0);
drawBox(slide2, "Exports", "VpcId, SubnetIds\nSG Ids, IAM Roles\nALB ARN, ClusterArn\nEndpoints", 5.2, 1.5, 1.6, 3.0, colors.container);

// Projects
drawContainer(slide2, "Per-Project Stacks (deploy-project.sh)", 7.5, 1.0, 2.0, 4.0);
drawBox(slide2, "cash-collection", "project.yaml", 7.7, 1.5, 1.6, 0.8);
drawBox(slide2, "poultry-sale", "project.yaml", 7.7, 2.5, 1.6, 0.8);
drawBox(slide2, "swine-api", "project.yaml", 7.7, 3.5, 1.6, 0.8);

drawArrow(slide2, 4.5, 2.5, 0.5, 0.2); // Shared -> Exports
drawArrow(slide2, 7.0, 2.5, 0.5, 0.2); // Exports -> Projects


// 3. Fargate - CI/CD Pipeline
let slide3 = pres.addSlide();
addSlideTitle(slide3, "3. CI/CD Pipeline Flow (8 Stages)");

// Trigger
drawBox(slide3, "Trigger", "S3 trigger.zip", 0.2, 2.5, 1.0, 0.8, colors.highlight);
drawArrow(slide3, 1.2, 2.9, 0.2, 0.2);

// Pipeline Stages - 8 Stages so need to be compact
const pipelineStages = [
  "1 Source", "2 Clone", "3 Swagger", "4 Lint", "5 Build", "6 Push", "7 Deploy", "8 Test"
];

let startX = 1.4;
pipelineStages.forEach((stage, i) => {
  drawBox(slide3, stage, "", startX + (i * 1.05), 2.5, 0.9, 0.8);
  if (i < pipelineStages.length - 1) {
    drawArrow(slide3, startX + (i * 1.05) + 0.9, 2.9, 0.15, 0.15);
  }
});

// External Services
drawBox(slide3, "Azure DevOps", "", 2.5, 1.0, 1.0, 0.6, colors.container);
drawArrow(slide3, 2.9, 1.6, 0, 0.9, "down"); // Clone

drawBox(slide3, "SNS Topic", "Lint Alerts", 4.6, 1.0, 1.0, 0.6, colors.highlight);
drawArrow(slide3, 5.0, 1.6, 0, 0.9, "down"); // Lint

drawBox(slide3, "ECR", "", 6.7, 1.0, 1.0, 0.6, colors.container);
drawArrow(slide3, 7.1, 1.6, 0, 0.9, "down"); // Push

drawBox(slide3, "ECS Service", "", 7.8, 1.0, 1.0, 0.6, colors.success);
drawArrow(slide3, 8.2, 1.6, 0, 0.9, "down"); // Deploy


// 4. Fargate - Request Flow
let slide4 = pres.addSlide();
addSlideTitle(slide4, "4. Request Flow");

const lanes = ["Client", "API Gateway", "VPC Link", "Int. ALB", "Target Group", "ECS Task", "Database"];
lanes.forEach((l, i) => {
  let lx = 0.5 + (i * 1.35);
  slide4.addShape(pres.shapes.RECTANGLE, { x: lx, y: 1.0, w: 1.2, h: 0.4, fill: { color: colors.container } });
  slide4.addText(l, { x: lx, y: 1.0, w: 1.2, h: 0.4, ...textStyles.label });
  drawLine(slide4, lx + 0.6, 1.4, 0, 3.8, colors.muted, true);
});

// Steps
let stepY = 1.6;
drawArrow(slide4, 1.1, stepY, 1.35, 0.1, "right", "HTTPS Request"); // C -> APIGW
stepY += 0.4;
drawArrow(slide4, 2.45, stepY, 1.35, 0.1, "right", "Forward (VPC Link)"); // APIGW -> VL
stepY += 0.4;
drawArrow(slide4, 3.8, stepY, 1.35, 0.1, "right", "HTTP :80"); // VL -> ALB
stepY += 0.4;
drawArrow(slide4, 5.15, stepY, 1.35, 0.1, "right", "Path Routing"); // ALB -> TG
stepY += 0.4;
drawArrow(slide4, 6.5, stepY, 1.35, 0.1, "right", "Forward to Container"); // TG -> ECS
stepY += 0.4;
drawArrow(slide4, 7.85, stepY, 1.35, 0.1, "right", "Query"); // ECS -> DB
stepY += 0.4;
drawArrow(slide4, 7.85, stepY, 1.35, 0.1, "left", "Result"); // DB -> ECS


// 5. Fargate - Security Groups
let slide5 = pres.addSlide();
addSlideTitle(slide5, "5. Security Groups Chain");

let sgY = 2.5;
drawBox(slide5, "Internet", "0.0.0.0/0", 0.5, sgY, 1.5, 1.2, colors.highlight);
drawArrow(slide5, 2.0, sgY + 0.5, 0.8, 0.2, "right", "TCP 443");

drawBox(slide5, "VpcLink SG", "Ingress: 443", 2.8, sgY, 1.5, 1.2);
drawArrow(slide5, 4.3, sgY + 0.5, 0.8, 0.2, "right", "TCP 80, 443");

drawBox(slide5, "ALB SG", "Ingress: VpcLink", 5.1, sgY, 1.5, 1.2);
drawArrow(slide5, 6.6, sgY + 0.5, 0.8, 0.2, "right", "TCP 80");

drawBox(slide5, "ECS SG", "Ingress: ALB SG\nEgress: Any", 7.4, sgY, 1.5, 1.2, colors.success);


// 6. Fargate - ALB Routing
let slide6 = pres.addSlide();
addSlideTitle(slide6, "6. ALB Path-Based Routing");

drawBox(slide6, "Internal ALB", "HTTP :80", 4.0, 1.0, 2.0, 1.0, colors.highlight);

// Paths
drawLine(slide6, 5.0, 2.0, 0, 0.5, colors.muted); // Vertical Trunk
drawLine(slide6, 2.0, 2.5, 6.0, 0, colors.muted); // Horizontal Bar

// Targets
drawLine(slide6, 2.0, 2.5, 0, 0.5, colors.muted);
drawBox(slide6, "Target Group 1", "/api/cash/*\nPriority 100", 1.0, 3.0, 2.0, 1.0);
drawArrow(slide6, 2.0, 4.0, 0, 0.5, "down");
drawBox(slide6, "ECS Service A", "cash-collection", 1.0, 4.5, 2.0, 0.8, colors.success);

drawLine(slide6, 5.0, 2.5, 0, 0.5, colors.muted);
drawBox(slide6, "Target Group 2", "/api/poultry/*\nPriority 200", 4.0, 3.0, 2.0, 1.0);
drawArrow(slide6, 5.0, 4.0, 0, 0.5, "down");
drawBox(slide6, "ECS Service B", "poultry-sale", 4.0, 4.5, 2.0, 0.8, colors.success);

drawLine(slide6, 8.0, 2.5, 0, 0.5, colors.muted);
drawBox(slide6, "Default Rule", "No Match\n404 JSON", 7.0, 3.0, 2.0, 1.0, colors.muted);


// 7. Fargate - ECS Deployment
let slide7 = pres.addSlide();
addSlideTitle(slide7, "7. ECS Deployment Strategy");

// Flowchart
let dy = 1.0;
drawBox(slide7, "Service Running", "Stable", 4.0, dy, 2.0, 0.8, colors.success);
drawArrow(slide7, 5.0, dy + 0.8, 0, 0.4, "down");

dy += 1.2;
drawBox(slide7, "New Image Pushed", "Trigger Deployment", 4.0, dy, 2.0, 0.8);
drawArrow(slide7, 5.0, dy + 0.8, 0, 0.4, "down");

dy += 1.2;
drawBox(slide7, "Launch New Task", "MaxPercent 200%", 4.0, dy, 2.0, 0.8);
drawArrow(slide7, 5.0, dy + 0.8, 0, 0.4, "down");

dy += 1.2;
drawBox(slide7, "Health Check", "/health (30s)", 4.0, dy, 2.0, 0.8, colors.highlight);

// Branching
drawLine(slide7, 3.5, dy + 0.4, 0.5, 0, colors.muted); // Left
drawBox(slide7, "Circuit Breaker", "Rollback", 1.5, dy, 2.0, 0.8, colors.highlight);

drawLine(slide7, 6.0, dy + 0.4, 0.5, 0, colors.muted); // Right
drawBox(slide7, "Drain Old Task", "MinHealthy 50%", 6.5, dy, 2.0, 0.8, colors.success);


// 8. Fargate - Monitoring
let slide8 = pres.addSlide();
addSlideTitle(slide8, "8. Monitoring & Observability");

drawContainer(slide8, "Metric Sources", 1.0, 1.5, 2.0, 3.0);
drawBox(slide8, "ECS Services", "", 1.2, 1.8, 1.6, 0.6);
drawBox(slide8, "ALB Metrics", "", 1.2, 2.6, 1.6, 0.6);
drawBox(slide8, "CodePipeline", "", 1.2, 3.4, 1.6, 0.6);

drawArrow(slide8, 3.0, 3.0, 1.0, 0.2);

drawContainer(slide8, "CloudWatch Alarms", 4.0, 1.5, 2.5, 3.0);
drawBox(slide8, "CPU > 80%", "", 4.2, 1.8, 2.1, 0.4, colors.highlight);
drawBox(slide8, "Memory > 80%", "", 4.2, 2.3, 2.1, 0.4, colors.highlight);
drawBox(slide8, "5xx Errors", "", 4.2, 2.8, 2.1, 0.4, colors.highlight);
drawBox(slide8, "Unhealthy Host", "", 4.2, 3.3, 2.1, 0.4, colors.highlight);

drawArrow(slide8, 6.5, 3.0, 1.0, 0.2);

drawBox(slide8, "SNS Topic", "Alerts (Email/Slack)", 7.5, 2.5, 2.0, 1.0, colors.success);


// 9. Fargate - Webhook
let slide9 = pres.addSlide();
addSlideTitle(slide9, "9. Webhook Integration");

const wlanes = ["Azure DevOps", "API Gateway", "Webhook Lambda", "CodePipeline"];
wlanes.forEach((l, i) => {
  let lx = 1.0 + (i * 2.2);
  slide9.addShape(pres.shapes.RECTANGLE, { x: lx, y: 1.0, w: 1.8, h: 0.4, fill: { color: colors.container } });
  slide9.addText(l, { x: lx, y: 1.0, w: 1.8, h: 0.4, ...textStyles.label });
  drawLine(slide9, lx + 0.9, 1.4, 0, 3.5, colors.muted, true);
});

let wy = 1.8;
drawArrow(slide9, 1.9, wy, 2.2, 0.1, "right", "POST /webhook"); // ADO -> APIGW
wy += 0.6;
drawArrow(slide9, 4.1, wy, 2.2, 0.1, "right", "Invoke (AWS_PROXY)"); // APIGW -> Lambda
wy += 0.6;
drawArrow(slide9, 6.3, wy, 2.2, 0.1, "right", "StartPipelineExecution"); // Lambda -> CP
wy += 0.6;
drawArrow(slide9, 6.3, wy, 2.2, 0.1, "left", "executionId"); // CP -> Lambda
wy += 0.6;
drawArrow(slide9, 4.1, wy, 2.2, 0.1, "left", "200 OK"); // Lambda -> APIGW

// 10. Iterative Migration Timeline (5 Waves)
let slide10 = pres.addSlide();
addSlideTitle(slide10, "10. Iterative Migration Strategy (5 Waves / 8 Weeks)");

// Timeline Axis (Weeks)
const weeks = ["Feb W1", "Feb W2", "Feb W3", "Feb W4", "Mar W1", "Mar W2", "Mar W3", "Mar W4"];
let axisY = 1.0;
let axisX = 0.5;
let weekW = 1.1;

weeks.forEach((w, i) => {
  let wx = axisX + (i * weekW);
  drawBox(slide10, w, "", wx, axisY, weekW - 0.05, 0.4, colors.container);
});

// Swimlanes
let laneY = 1.6;
const timelineLanes = [
  { title: "Infrastructure", color: colors.box },
  { title: "Wave 1: Fnd", color: colors.container },
  { title: "Wave 2: Cash", color: colors.container },
  { title: "Wave 3: Pltry", color: colors.container },
  { title: "Wave 4: Rpts", color: colors.container },
  { title: "Wave 5: Adm", color: colors.container }
];

timelineLanes.forEach((l) => {
  slide10.addShape(pres.shapes.RECTANGLE, { x: 0.2, y: laneY, w: 9.6, h: 0.6, fill: { color: l.color, transparency: 80 } });
  slide10.addText(l.title, { x: 0.2, y: laneY + 0.2, w: 1.5, h: 0.2, fontSize: 8, color: colors.accent, bold: true, align: "left" });
  laneY += 0.7;
});

// Task Helper
function drawTask(slide, laneIndex, startWeek, durationWeeks, title, status) {
  let y = 1.6 + (laneIndex * 0.7) + 0.15;
  let x = axisX + (startWeek * weekW);
  let w = durationWeeks * weekW - 0.1;
  let color = status === "done" ? colors.success : (status === "active" ? colors.highlight : colors.muted);

  if (title.includes("Deploy")) color = colors.success;
  if (title.includes("Lint")) color = colors.highlight;
  if (title.includes("Test")) color = colors.box;

  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: x, y: y, w: w, h: 0.3,
    fill: { color: color },
    rectRadius: 0.1
  });
  slide.addText(title, { x: x, y: y, w: w, h: 0.3, fontSize: 6, color: colors.bg, align: "center", bold: true });
}

// 1. Infrastructure
drawTask(slide10, 0, 0, 1, "Foundation & CI/CD", "done");

// 2. Wave 1: Foundation (Auth/Shared)
drawTask(slide10, 1, 0.5, 0.6, "Upg", "active");
drawTask(slide10, 1, 1.1, 0.4, "Lnt", "pending");
drawTask(slide10, 1, 1.5, 0.4, "Tst", "pending");
drawTask(slide10, 1, 1.9, 0.4, "Dep", "pending");

// 3. Wave 2: Core Biz (Cash)
drawTask(slide10, 2, 1.5, 0.7, "Upg", "pending");
drawTask(slide10, 2, 2.2, 0.4, "Lnt", "pending");
drawTask(slide10, 2, 2.6, 0.4, "Tst", "pending");
drawTask(slide10, 2, 3.0, 0.4, "Dep", "pending");

// 4. Wave 3: Core Biz (Poultry)
drawTask(slide10, 3, 2.6, 0.7, "Upg", "pending");
drawTask(slide10, 3, 3.3, 0.4, "Lnt", "pending");
drawTask(slide10, 3, 3.7, 0.4, "Tst", "pending");
drawTask(slide10, 3, 4.1, 0.4, "Dep", "pending");

// 5. Wave 4: Reporting
drawTask(slide10, 4, 3.7, 0.7, "Upg", "pending");
drawTask(slide10, 4, 4.4, 0.4, "Lnt", "pending");
drawTask(slide10, 4, 4.8, 0.4, "Tst", "pending");
drawTask(slide10, 4, 5.2, 0.4, "Dep", "pending");

// 6. Wave 5: Admin
drawTask(slide10, 5, 4.8, 0.7, "Upg", "pending");
drawTask(slide10, 5, 5.5, 0.4, "Lnt", "pending");
drawTask(slide10, 5, 5.9, 0.4, "Tst", "pending");
drawTask(slide10, 5, 6.3, 0.4, "Dep", "pending");

// Legend to explain flow
drawBox(slide10, "Cycle:", "Upg(Upgrade) → Lnt(Lint) → Tst(Test) → Dep(Deploy)", 3.0, 6.2, 5.0, 0.5, colors.container);

pres.writeFile({ fileName: "Infrastructure_Presentation.pptx" });

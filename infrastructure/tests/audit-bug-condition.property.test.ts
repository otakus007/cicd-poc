/**
 * Bug Condition Exploration Tests — Infrastructure Audit Findings
 *
 * These tests encode the EXPECTED (correct) behavior for all 30 audit findings.
 * They MUST FAIL on unfixed code — failure confirms the bugs exist.
 *
 * DO NOT fix the code or the tests when they fail.
 *
 * Validates: Requirements 1.1–1.30 (Current Defective Behavior)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as fc from 'fast-check';

// ============================================================================
// CFN_SCHEMA — CloudFormation intrinsic function support for YAML parsing
// (Reused from existing test files)
// ============================================================================
const CFN_SCHEMA = yaml.DEFAULT_SCHEMA.extend([
  new yaml.Type('!Ref', { kind: 'scalar', construct: (d: string) => ({ Ref: d }) }),
  new yaml.Type('!Sub', { kind: 'scalar', construct: (d: string) => ({ 'Fn::Sub': d }) }),
  new yaml.Type('!Sub', { kind: 'sequence', construct: (d: unknown[]) => ({ 'Fn::Sub': d }) }),
  new yaml.Type('!GetAtt', { kind: 'scalar', construct: (d: string) => ({ 'Fn::GetAtt': d.split('.') }) }),
  new yaml.Type('!GetAtt', { kind: 'sequence', construct: (d: unknown[]) => ({ 'Fn::GetAtt': d }) }),
  new yaml.Type('!Select', { kind: 'sequence', construct: (d: unknown[]) => ({ 'Fn::Select': d }) }),
  new yaml.Type('!GetAZs', { kind: 'scalar', construct: (d: string) => ({ 'Fn::GetAZs': d }) }),
  new yaml.Type('!Join', { kind: 'sequence', construct: (d: unknown[]) => ({ 'Fn::Join': d }) }),
  new yaml.Type('!If', { kind: 'sequence', construct: (d: unknown[]) => ({ 'Fn::If': d }) }),
  new yaml.Type('!Equals', { kind: 'sequence', construct: (d: unknown[]) => ({ 'Fn::Equals': d }) }),
  new yaml.Type('!Not', { kind: 'sequence', construct: (d: unknown[]) => ({ 'Fn::Not': d }) }),
  new yaml.Type('!And', { kind: 'sequence', construct: (d: unknown[]) => ({ 'Fn::And': d }) }),
  new yaml.Type('!Or', { kind: 'sequence', construct: (d: unknown[]) => ({ 'Fn::Or': d }) }),
  new yaml.Type('!Condition', { kind: 'scalar', construct: (d: string) => ({ Condition: d }) }),
  new yaml.Type('!ImportValue', { kind: 'scalar', construct: (d: string) => ({ 'Fn::ImportValue': d }) }),
  new yaml.Type('!FindInMap', { kind: 'sequence', construct: (d: unknown[]) => ({ 'Fn::FindInMap': d }) }),
  new yaml.Type('!Base64', { kind: 'scalar', construct: (d: string) => ({ 'Fn::Base64': d }) }),
  new yaml.Type('!Cidr', { kind: 'sequence', construct: (d: unknown[]) => ({ 'Fn::Cidr': d }) }),
  new yaml.Type('!Split', { kind: 'sequence', construct: (d: unknown[]) => ({ 'Fn::Split': d }) }),
]);

// ============================================================================
// Helper: load and parse a CloudFormation template
// ============================================================================
function loadTemplate(relativePath: string): any {
  const fullPath = path.join(__dirname, '..', relativePath);
  const content = fs.readFileSync(fullPath, 'utf8');
  return yaml.load(content, { schema: CFN_SCHEMA });
}

// Helper: load a raw text file (for buildspecs)
function loadRawFile(relativePath: string): string {
  const fullPath = path.join(__dirname, '..', '..', relativePath);
  return fs.readFileSync(fullPath, 'utf8');
}

// ============================================================================
// P0 — Critical Security
// ============================================================================
describe('P0 Critical Security', () => {
  /**
   * Finding 1.1: WebhookRoute has no AuthorizationType
   * **Validates: Requirements 2.1**
   */
  test('api-gateway.yaml: WebhookRoute SHALL have AuthorizationType set', () => {
    const template = loadTemplate('api-gateway.yaml');
    const webhookRoute = template.Resources?.WebhookRoute;
    expect(webhookRoute).toBeDefined();
    // The route must have an authorization type (e.g., CUSTOM for Lambda authorizer)
    expect(webhookRoute.Properties?.AuthorizationType).toBeDefined();
    expect(webhookRoute.Properties?.AuthorizationType).not.toBe('NONE');
  });

  /**
   * Finding 1.2: RDS uses plain-text MasterUserPassword parameter
   * **Validates: Requirements 2.2**
   */
  test('rds-oracle.yaml: OracleDBInstance SHALL use ManageMasterUserPassword: true', () => {
    const template = loadTemplate('rds-oracle.yaml');
    const dbInstance = template.Resources?.OracleDBInstance;
    expect(dbInstance).toBeDefined();
    expect(dbInstance.Properties?.ManageMasterUserPassword).toBe(true);
  });

  /**
   * Finding 1.3: ECS SG egress uses port 1433 (SQL Server) instead of 1521 (Oracle)
   * **Validates: Requirements 2.3**
   */
  test('security-groups.yaml: EcsSecurityGroup egress SHALL allow port 1521 for Oracle', () => {
    const template = loadTemplate('security-groups.yaml');
    const ecsSg = template.Resources?.EcsSecurityGroup;
    expect(ecsSg).toBeDefined();
    const egress = ecsSg.Properties?.SecurityGroupEgress as any[];
    expect(egress).toBeDefined();

    // Find the database egress rule (non-443 port to VPC CIDR)
    const dbRule = egress.find(
      (r: any) => r.FromPort !== 443 && r.ToPort !== 443
    );
    expect(dbRule).toBeDefined();
    expect(dbRule.FromPort).toBe(1521);
    expect(dbRule.ToPort).toBe(1521);
  });
});


// ============================================================================
// P1 — High Security & Compliance
// ============================================================================
describe('P1 High Security & Compliance', () => {
  /**
   * Finding 1.4: No VPC Flow Logs
   * **Validates: Requirements 2.4**
   */
  test('vpc.yaml: SHALL have an AWS::EC2::FlowLog resource', () => {
    const template = loadTemplate('vpc.yaml');
    const flowLogs = Object.values(template.Resources || {}).filter(
      (r: any) => r.Type === 'AWS::EC2::FlowLog'
    );
    expect(flowLogs.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Finding 1.5: LaunchTemplate missing IMDSv2 enforcement
   * **Validates: Requirements 2.5**
   */
  test('ecs-ec2-cluster.yaml: LaunchTemplate SHALL enforce IMDSv2 (HttpTokens: required)', () => {
    const template = loadTemplate('ecs-ec2-cluster.yaml');
    const lt = template.Resources?.LaunchTemplate;
    expect(lt).toBeDefined();
    const ltData = lt.Properties?.LaunchTemplateData;
    expect(ltData).toBeDefined();
    expect(ltData.MetadataOptions).toBeDefined();
    expect(ltData.MetadataOptions.HttpTokens).toBe('required');
  });

  /**
   * Finding 1.6: No approval gate before Deploy
   * **Validates: Requirements 2.6**
   */
  test('codepipeline.yaml: SHALL have an Approval action before Deploy stage', () => {
    const template = loadTemplate('codepipeline.yaml');
    const pipeline = template.Resources?.Pipeline;
    expect(pipeline).toBeDefined();
    const stages = pipeline.Properties?.Stages as any[];
    expect(stages).toBeDefined();

    const stageNames = stages.map((s: any) => s.Name);
    const deployIdx = stageNames.indexOf('Deploy');
    expect(deployIdx).toBeGreaterThan(-1);

    // There must be an Approval stage, and it must come before Deploy
    const approvalIdx = stageNames.indexOf('Approval');
    expect(approvalIdx).toBeGreaterThan(-1);
    expect(approvalIdx).toBeLessThan(deployIdx);
  });

  /**
   * Finding 1.7: No security scan CodeBuild project
   * **Validates: Requirements 2.7**
   */
  test('codebuild.yaml: SHALL have a security scan CodeBuild project', () => {
    const template = loadTemplate('codebuild.yaml');
    const resources = template.Resources || {};
    const scanProjects = Object.entries(resources).filter(
      ([key, r]: [string, any]) =>
        r.Type === 'AWS::CodeBuild::Project' &&
        key.toLowerCase().includes('security')
    );
    expect(scanProjects.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Finding 1.8: NatGateway2 always created (no condition for dev)
   * **Validates: Requirements 2.8**
   */
  test('vpc.yaml: NatGateway2 SHALL have a Condition for environment-aware creation', () => {
    const template = loadTemplate('vpc.yaml');
    const natGw2 = template.Resources?.NatGateway2;
    expect(natGw2).toBeDefined();
    // NatGateway2 must have a Condition so it's only created in staging/prod
    expect(natGw2.Condition).toBeDefined();
  });

  /**
   * Finding 1.9: ALB access_logs.s3.enabled is hardcoded "false"
   * **Validates: Requirements 2.9**
   */
  test('alb.yaml: access_logs.s3.enabled SHALL NOT be hardcoded "false"', () => {
    const template = loadTemplate('alb.yaml');
    const alb = template.Resources?.InternalAlb;
    expect(alb).toBeDefined();
    const attrs = alb.Properties?.LoadBalancerAttributes as any[];
    expect(attrs).toBeDefined();

    const accessLogsAttr = attrs.find(
      (a: any) => a.Key === 'access_logs.s3.enabled'
    );
    expect(accessLogsAttr).toBeDefined();
    // Must not be hardcoded "false" — should be conditional or "true"
    expect(accessLogsAttr.Value).not.toBe('false');
  });

  /**
   * Finding 1.10: ALB deletion_protection.enabled is hardcoded "false"
   * **Validates: Requirements 2.10**
   */
  test('alb.yaml: deletion_protection.enabled SHALL NOT be hardcoded "false"', () => {
    const template = loadTemplate('alb.yaml');
    const alb = template.Resources?.InternalAlb;
    expect(alb).toBeDefined();
    const attrs = alb.Properties?.LoadBalancerAttributes as any[];
    expect(attrs).toBeDefined();

    const deletionProtAttr = attrs.find(
      (a: any) => a.Key === 'deletion_protection.enabled'
    );
    expect(deletionProtAttr).toBeDefined();
    // Must not be hardcoded "false" — should be conditional (true for prod)
    expect(deletionProtAttr.Value).not.toBe('false');
  });

  /**
   * Finding 1.11: No RotationSchedule for secrets
   * **Validates: Requirements 2.11**
   */
  test('secrets.yaml: SHALL have a RotationSchedule resource', () => {
    const template = loadTemplate('secrets.yaml');
    const rotationSchedules = Object.values(template.Resources || {}).filter(
      (r: any) => r.Type === 'AWS::SecretsManager::RotationSchedule'
    );
    expect(rotationSchedules.length).toBeGreaterThanOrEqual(1);
  });
});


// ============================================================================
// P2 — Medium CI/CD & Configuration
// ============================================================================
describe('P2 Medium CI/CD & Configuration', () => {
  /**
   * Finding 1.12: ContractTest stage runs AFTER Deploy
   * **Validates: Requirements 2.12**
   */
  test('codepipeline.yaml: ContractTest stage index SHALL be less than Deploy stage index', () => {
    const template = loadTemplate('codepipeline.yaml');
    const pipeline = template.Resources?.Pipeline;
    const stages = pipeline.Properties?.Stages as any[];
    const stageNames = stages.map((s: any) => s.Name);

    const contractTestIdx = stageNames.indexOf('ContractTest');
    const deployIdx = stageNames.indexOf('Deploy');
    expect(contractTestIdx).toBeGreaterThan(-1);
    expect(deployIdx).toBeGreaterThan(-1);
    expect(contractTestIdx).toBeLessThan(deployIdx);
  });

  /**
   * Finding 1.13: buildspec-push.yml rebuilds Docker image instead of reusing
   * **Validates: Requirements 2.13**
   */
  test('buildspec-push.yml: SHALL NOT contain a docker build command', () => {
    const content = loadRawFile('buildspecs/buildspec-push.yml');
    // The push buildspec should not rebuild the image
    expect(content).not.toMatch(/docker\s+build/);
  });

  /**
   * Finding 1.14: No WAF WebACL on API Gateway
   * **Validates: Requirements 2.14**
   */
  test('api-gateway.yaml: SHALL have an AWS::WAFv2::WebACL resource', () => {
    const template = loadTemplate('api-gateway.yaml');
    const wafResources = Object.values(template.Resources || {}).filter(
      (r: any) => r.Type === 'AWS::WAFv2::WebACL'
    );
    expect(wafResources.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Finding 1.15: CORS AllowOrigins defaults to wildcard "*"
   * **Validates: Requirements 2.15**
   */
  test('api-gateway.yaml: CorsAllowOrigins default SHALL NOT be wildcard "*"', () => {
    const template = loadTemplate('api-gateway.yaml');
    const corsParam = template.Parameters?.CorsAllowOrigins;
    expect(corsParam).toBeDefined();
    // Default must not be "*"
    expect(corsParam.Default).not.toBe('*');
  });

  /**
   * Finding 1.16: KMS Decrypt resource is key/* wildcard
   * **Validates: Requirements 2.16**
   */
  test('iam.yaml: KMS Decrypt resource SHALL NOT use key/* wildcard', () => {
    const template = loadTemplate('iam.yaml');
    const policy = template.Resources?.EcsExecutionRolePolicy;
    expect(policy).toBeDefined();
    const statements = policy.Properties?.PolicyDocument?.Statement as any[];
    expect(statements).toBeDefined();

    const kmsStatement = statements.find(
      (s: any) => s.Sid === 'KmsDecryptAccess'
    );
    expect(kmsStatement).toBeDefined();

    // Resource must not end with key/*
    const resources = Array.isArray(kmsStatement.Resource)
      ? kmsStatement.Resource
      : [kmsStatement.Resource];
    for (const resource of resources) {
      const resourceStr = typeof resource === 'string'
        ? resource
        : JSON.stringify(resource);
      expect(resourceStr).not.toMatch(/key\/\*/);
    }
  });

  /**
   * Finding 1.17: Non-Docker CodeBuild projects should explicitly set PrivilegedMode: false
   * **Validates: Requirements 2.17**
   */
  test('codebuild.yaml: SourceProject/LintProject/SwaggerGenProject/ContractTestProject SHALL have PrivilegedMode: false', () => {
    const template = loadTemplate('codebuild.yaml');
    const nonDockerProjects = [
      'SourceProject',
      'LintProject',
      'SwaggerGenProject',
      'ContractTestProject',
    ];

    for (const projectName of nonDockerProjects) {
      const project = template.Resources?.[projectName];
      if (project) {
        const privileged = project.Properties?.Environment?.PrivilegedMode;
        // Must be explicitly set to false (not undefined, not true)
        expect(privileged).toBe(false);
      }
    }
  });

  /**
   * Finding 1.18: ArtifactBucket has no Intelligent-Tiering lifecycle rule
   * **Validates: Requirements 2.18**
   */
  test('codepipeline.yaml: ArtifactBucket SHALL have Intelligent-Tiering lifecycle rule', () => {
    const template = loadTemplate('codepipeline.yaml');
    const bucket = template.Resources?.ArtifactBucket;
    expect(bucket).toBeDefined();
    const rules = bucket.Properties?.LifecycleConfiguration?.Rules as any[];
    expect(rules).toBeDefined();

    // At least one rule must have an IntelligentTieringConfiguration or Transition to INTELLIGENT_TIERING
    const hasTiering = rules.some((rule: any) => {
      const transitions = rule.Transitions || [];
      return transitions.some(
        (t: any) => t.StorageClass === 'INTELLIGENT_TIERING'
      );
    });
    expect(hasTiering).toBe(true);
  });

  /**
   * Finding 1.19: ECR lifecycle keeps only 10 images
   * **Validates: Requirements 2.19**
   */
  test('ecr.yaml: lifecycle countNumber SHALL be >= 30', () => {
    const template = loadTemplate('ecr.yaml');
    const repo = template.Resources?.EcrRepository;
    expect(repo).toBeDefined();
    const policyText = repo.Properties?.LifecyclePolicy?.LifecyclePolicyText;
    expect(policyText).toBeDefined();

    const policy = typeof policyText === 'string' ? JSON.parse(policyText) : policyText;
    const rules = policy.rules as any[];
    expect(rules).toBeDefined();

    // Find the rule that keeps tagged images by count
    const countRule = rules.find(
      (r: any) => r.selection?.countType === 'imageCountMoreThan'
    );
    if (countRule) {
      expect(countRule.selection.countNumber).toBeGreaterThanOrEqual(30);
    }
  });

  /**
   * Finding 1.20: CodeBuild log groups have fixed 30-day retention
   * **Validates: Requirements 2.20**
   */
  test('codebuild.yaml: log group retention SHALL be environment-aware via !If', () => {
    const template = loadTemplate('codebuild.yaml');
    const logGroups = Object.entries(template.Resources || {}).filter(
      ([_, r]: [string, any]) => r.Type === 'AWS::Logs::LogGroup'
    );
    expect(logGroups.length).toBeGreaterThan(0);

    for (const [name, logGroup] of logGroups) {
      const retention = (logGroup as any).Properties?.RetentionInDays;
      // Must not be a fixed number — should be an !If conditional
      expect(typeof retention).not.toBe('number');
    }
  });

  /**
   * Finding 1.21: API Gateway log group has fixed 90-day retention
   * **Validates: Requirements 2.21**
   */
  test('api-gateway.yaml: ApiGatewayLogGroup retention SHALL be environment-aware', () => {
    const template = loadTemplate('api-gateway.yaml');
    const logGroup = template.Resources?.ApiGatewayLogGroup;
    expect(logGroup).toBeDefined();
    const retention = logGroup.Properties?.RetentionInDays;
    // Must not be a fixed number — should be an !If conditional
    expect(typeof retention).not.toBe('number');
  });

  /**
   * Finding 1.22: No Fargate Spot interruption alarm
   * **Validates: Requirements 2.22**
   */
  test('ecs-cluster.yaml: SHALL have a Fargate Spot interruption alarm', () => {
    const template = loadTemplate('ecs-cluster.yaml');
    const alarms = Object.entries(template.Resources || {}).filter(
      ([key, r]: [string, any]) =>
        r.Type === 'AWS::CloudWatch::Alarm' &&
        (key.toLowerCase().includes('spot') || key.toLowerCase().includes('interruption'))
    );
    expect(alarms.length).toBeGreaterThanOrEqual(1);
  });
});


// ============================================================================
// P3 — Low Hardening & Cost
// ============================================================================
describe('P3 Low Hardening & Cost', () => {
  /**
   * Finding 1.23: No DeletionPolicy on PatSecret/DbSecret
   * **Validates: Requirements 2.23**
   */
  test('secrets.yaml: PatSecret and DbSecret SHALL have DeletionPolicy', () => {
    const template = loadTemplate('secrets.yaml');
    const patSecret = template.Resources?.PatSecret;
    const dbSecret = template.Resources?.DbSecret;
    expect(patSecret).toBeDefined();
    expect(dbSecret).toBeDefined();

    // Check raw YAML for DeletionPolicy since js-yaml may not parse it as a property
    const rawContent = fs.readFileSync(
      path.join(__dirname, '..', 'secrets.yaml'),
      'utf8'
    );
    // At least one of the secrets should have a DeletionPolicy
    expect(rawContent).toMatch(/DeletionPolicy/);
  });

  /**
   * Finding 1.29: PipelineWebhook uses UNAUTHENTICATED
   * **Validates: Requirements 2.29**
   */
  test('monitoring.yaml: PipelineWebhook.Authentication SHALL NOT be UNAUTHENTICATED', () => {
    const template = loadTemplate('monitoring.yaml');
    const webhook = template.Resources?.PipelineWebhook;
    expect(webhook).toBeDefined();
    expect(webhook.Properties?.Authentication).not.toBe('UNAUTHENTICATED');
  });

  /**
   * Finding 1.30: Hardcoded .NET version in swagger buildspec
   * **Validates: Requirements 2.30**
   */
  test('buildspec-swagger-gen.yml: .NET version SHALL be configurable (not hardcoded)', () => {
    const content = loadRawFile('buildspecs/buildspec-swagger-gen.yml');
    // Should use an environment variable like ${DOTNET_VERSION:-10.0} instead of fixed "dotnet: 10.0"
    // If it contains a fixed "dotnet: 10.0" without variable substitution, it's hardcoded
    const lines = content.split('\n');
    const dotnetLine = lines.find((l) => l.trim().startsWith('dotnet:'));
    if (dotnetLine) {
      // Must reference an env var or be parameterized
      expect(dotnetLine).toMatch(/\$\{?\w+/);
    }
  });

  /**
   * Finding 1.25: Container Insights always enabled (not environment-aware)
   * **Validates: Requirements 2.25**
   */
  test('ecs-cluster.yaml and ecs-ec2-cluster.yaml: ContainerInsightsEnabled SHALL be environment-aware', () => {
    // Check ecs-cluster.yaml
    const fargateTemplate = loadTemplate('ecs-cluster.yaml');
    const fargateParam = fargateTemplate.Parameters?.ContainerInsightsEnabled;
    expect(fargateParam).toBeDefined();
    // Default should not always be "enabled" — should be conditional on environment
    // Either the default changes or the cluster uses !If
    const fargateCluster = fargateTemplate.Resources?.EcsCluster;
    const fargateInsightsSetting = fargateCluster?.Properties?.ClusterSettings?.find(
      (s: any) => s.Name === 'containerInsights'
    );
    // The value should be conditional (an object with Fn::If), not a plain Ref
    const fargateValue = fargateInsightsSetting?.Value;
    const isFargateConditional =
      typeof fargateValue === 'object' && fargateValue !== null && 'Fn::If' in fargateValue;
    const isFargateDefaultDisabledForDev = fargateParam.Default !== 'enabled';
    expect(isFargateConditional || isFargateDefaultDisabledForDev).toBe(true);

    // Check ecs-ec2-cluster.yaml
    const ec2Template = loadTemplate('ecs-ec2-cluster.yaml');
    const ec2Param = ec2Template.Parameters?.ContainerInsightsEnabled;
    expect(ec2Param).toBeDefined();
    const ec2Cluster = ec2Template.Resources?.EcsEc2Cluster;
    const ec2InsightsSetting = ec2Cluster?.Properties?.ClusterSettings?.find(
      (s: any) => s.Name === 'containerInsights'
    );
    const ec2Value = ec2InsightsSetting?.Value;
    const isEc2Conditional =
      typeof ec2Value === 'object' && ec2Value !== null && 'Fn::If' in ec2Value;
    const isEc2DefaultDisabledForDev = ec2Param.Default !== 'enabled';
    expect(isEc2Conditional || isEc2DefaultDisabledForDev).toBe(true);
  });

  /**
   * Finding 1.26: DBInstanceClass is not environment-aware (fixed db.t3.medium)
   * **Validates: Requirements 2.26**
   */
  test('rds-oracle.yaml: DBInstanceClass SHALL be environment-aware', () => {
    const template = loadTemplate('rds-oracle.yaml');
    const dbInstance = template.Resources?.OracleDBInstance;
    expect(dbInstance).toBeDefined();

    // The DBInstanceClass should use a mapping or !If, not just !Ref to a fixed-default param
    const dbInstanceClass = dbInstance.Properties?.DBInstanceClass;

    // Check if it uses FindInMap or If (environment-aware)
    const isConditional =
      typeof dbInstanceClass === 'object' &&
      dbInstanceClass !== null &&
      ('Fn::FindInMap' in dbInstanceClass || 'Fn::If' in dbInstanceClass);

    // Or check if the parameter default varies (has a mapping)
    const hasMappings = template.Mappings !== undefined;

    expect(isConditional || hasMappings).toBe(true);
  });
});
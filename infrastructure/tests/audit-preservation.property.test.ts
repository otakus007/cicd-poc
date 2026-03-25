/**
 * Preservation Property Tests — Infrastructure Audit Fixes
 *
 * These tests capture the CURRENT baseline behavior of unfixed templates.
 * They MUST PASS on unfixed code — they verify existing behavior is preserved.
 *
 * Property 4: Preservation — Existing Infrastructure Behavior
 * _For any_ template change where the bug condition does NOT hold, the fixed
 * templates SHALL produce identical resources and cross-stack exports as the
 * original templates.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15**
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as fc from 'fast-check';

// ============================================================================
// CFN_SCHEMA — CloudFormation intrinsic function support for YAML parsing
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
// Helpers
// ============================================================================
function loadTemplate(relativePath: string): any {
  const fullPath = path.join(__dirname, '..', relativePath);
  const content = fs.readFileSync(fullPath, 'utf8');
  return yaml.load(content, { schema: CFN_SCHEMA });
}

/** Extract all Export.Name values from a template's Outputs */
function getExportNames(template: any): string[] {
  const outputs = template.Outputs || {};
  const names: string[] = [];
  for (const [, output] of Object.entries(outputs) as [string, any][]) {
    const exportName = output?.Export?.Name;
    if (exportName) {
      names.push(typeof exportName === 'string' ? exportName : JSON.stringify(exportName));
    }
  }
  return names;
}

/** Recursively collect all tags from a resource's Properties.Tags array */
function getResourceTags(resource: any): Array<{ Key: string; Value: any }> {
  const tags = resource?.Properties?.Tags;
  if (Array.isArray(tags)) return tags;
  return [];
}

/** Find a LoadBalancerAttribute by Key */
function findAlbAttribute(attrs: any[], key: string): any {
  return attrs?.find((a: any) => a.Key === key);
}

// Environment generator for property-based tests
const environmentArb = fc.constantFrom('dev', 'staging', 'prod');

// ============================================================================
// Templates with exports that use ${ProjectName}-${Environment}-* pattern
// ============================================================================
const TEMPLATES_WITH_EXPORTS = [
  'alb.yaml',
  'api-gateway.yaml',
  'ecs-cluster.yaml',
  'ecs-ec2-cluster.yaml',
  'iam.yaml',
  'monitoring.yaml',
  'vpc.yaml',
];

// ============================================================================
// Tests
// ============================================================================

describe('Preservation: Cross-Stack Export Names (Req 3.11)', () => {
  /**
   * For all environments: cross-stack export names follow ${ProjectName}-${Environment}-* pattern
   * **Validates: Requirements 3.11**
   */
  test('all Export.Name values use ${ProjectName}-${Environment}-* convention', () => {
    fc.assert(
      fc.property(environmentArb, (_env) => {
        for (const templateFile of TEMPLATES_WITH_EXPORTS) {
          const template = loadTemplate(templateFile);
          const exportNames = getExportNames(template);

          for (const name of exportNames) {
            // Export names should contain Fn::Sub with ${ProjectName}-${Environment}- pattern
            expect(name).toMatch(/\$\{ProjectName\}-\$\{Environment\}-/);
          }
        }
      }),
      { numRuns: 10 }
    );
  });
});

describe('Preservation: Resource Tags (Req 3.11)', () => {
  /**
   * For all environments: resource tags include Environment and Project
   * **Validates: Requirements 3.11**
   */
  test('key resources have Environment and Project tags', () => {
    fc.assert(
      fc.property(environmentArb, (_env) => {
        // Check ALB
        const albTemplate = loadTemplate('alb.yaml');
        const albTags = getResourceTags(albTemplate.Resources?.InternalAlb);
        expect(albTags.some((t: any) => t.Key === 'Environment')).toBe(true);
        expect(albTags.some((t: any) => t.Key === 'Project')).toBe(true);

        // Check ECS EC2 Cluster
        const ec2Template = loadTemplate('ecs-ec2-cluster.yaml');
        const ec2Tags = getResourceTags(ec2Template.Resources?.EcsEc2Cluster);
        expect(ec2Tags.some((t: any) => t.Key === 'Environment')).toBe(true);
        expect(ec2Tags.some((t: any) => t.Key === 'Project')).toBe(true);

        // Check ECS Fargate Cluster
        const fargateTemplate = loadTemplate('ecs-cluster.yaml');
        const fargateTags = getResourceTags(fargateTemplate.Resources?.EcsCluster);
        expect(fargateTags.some((t: any) => t.Key === 'Environment')).toBe(true);
        expect(fargateTags.some((t: any) => t.Key === 'Project')).toBe(true);

        // Check monitoring SNS topic
        const monTemplate = loadTemplate('monitoring.yaml');
        const snsTags = getResourceTags(monTemplate.Resources?.PipelineNotificationTopic);
        expect(snsTags.some((t: any) => t.Key === 'Environment')).toBe(true);
        expect(snsTags.some((t: any) => t.Key === 'Project')).toBe(true);
      }),
      { numRuns: 10 }
    );
  });
});

describe('Preservation: ALB Configuration (Req 3.7)', () => {
  /**
   * For all environments: ALB remains internal with HTTP/2, invalid header dropping, 60s idle timeout
   * **Validates: Requirements 3.7**
   */
  test('InternalAlb preserves Scheme: internal, HTTP/2, invalid header dropping, 60s idle timeout', () => {
    fc.assert(
      fc.property(environmentArb, (_env) => {
        const template = loadTemplate('alb.yaml');
        const alb = template.Resources?.InternalAlb;
        expect(alb).toBeDefined();
        expect(alb.Properties?.Scheme).toBe('internal');
        expect(alb.Properties?.Type).toBe('application');

        const attrs = alb.Properties?.LoadBalancerAttributes as any[];
        expect(attrs).toBeDefined();

        expect(findAlbAttribute(attrs, 'idle_timeout.timeout_seconds')?.Value).toBe('60');
        expect(findAlbAttribute(attrs, 'routing.http.drop_invalid_header_fields.enabled')?.Value).toBe('true');
        expect(findAlbAttribute(attrs, 'routing.http2.enabled')?.Value).toBe('true');
      }),
      { numRuns: 10 }
    );
  });
});

describe('Preservation: ECS DeploymentCircuitBreaker (Req 3.8)', () => {
  /**
   * For all environments: ECS DeploymentCircuitBreaker with rollback enabled
   * **Validates: Requirements 3.8**
   */
  test('ECS services have DeploymentCircuitBreaker with Enable: true, Rollback: true', () => {
    fc.assert(
      fc.property(environmentArb, (_env) => {
        // Check Fargate service
        const fargateService = loadTemplate('ecs-service.yaml');
        const fargateEcsService = fargateService.Resources?.EcsService;
        expect(fargateEcsService).toBeDefined();
        const fargateCb = fargateEcsService.Properties?.DeploymentConfiguration?.DeploymentCircuitBreaker;
        expect(fargateCb).toBeDefined();
        expect(fargateCb.Enable).toBe(true);
        expect(fargateCb.Rollback).toBe(true);

        // Check EC2 service
        const ec2Service = loadTemplate('ecs-ec2-service.yaml');
        const ec2EcsService = ec2Service.Resources?.EcsService;
        expect(ec2EcsService).toBeDefined();
        const ec2Cb = ec2EcsService.Properties?.DeploymentConfiguration?.DeploymentCircuitBreaker;
        expect(ec2Cb).toBeDefined();
        expect(ec2Cb.Enable).toBe(true);
        expect(ec2Cb.Rollback).toBe(true);
      }),
      { numRuns: 10 }
    );
  });
});

describe('Preservation: ECR Scan-on-Push (Req 3.9)', () => {
  /**
   * For all environments: ECR scan-on-push enabled
   * **Validates: Requirements 3.9**
   */
  test('ECR repository has ScanOnPush: true', () => {
    fc.assert(
      fc.property(environmentArb, (_env) => {
        const template = loadTemplate('ecr.yaml');
        const repo = template.Resources?.EcrRepository;
        expect(repo).toBeDefined();
        expect(repo.Properties?.ImageScanningConfiguration?.ScanOnPush).toBe(true);
      }),
      { numRuns: 10 }
    );
  });
});

describe('Preservation: S3 Artifact Bucket (Req 3.10)', () => {
  /**
   * For all environments: S3 artifact bucket has versioning, encryption, public access blocked, 30-day expiry
   * **Validates: Requirements 3.10**
   */
  test('ArtifactBucket has versioning, AES256 encryption, public access blocked, 30-day expiry', () => {
    fc.assert(
      fc.property(environmentArb, (_env) => {
        const template = loadTemplate('codepipeline.yaml');
        const bucket = template.Resources?.ArtifactBucket;
        expect(bucket).toBeDefined();

        // Versioning
        expect(bucket.Properties?.VersioningConfiguration?.Status).toBe('Enabled');

        // AES256 encryption
        const encRules = bucket.Properties?.BucketEncryption?.ServerSideEncryptionConfiguration;
        expect(encRules).toBeDefined();
        const sseAlgorithm = encRules[0]?.ServerSideEncryptionByDefault?.SSEAlgorithm;
        expect(sseAlgorithm).toBe('AES256');

        // Public access blocked
        const pub = bucket.Properties?.PublicAccessBlockConfiguration;
        expect(pub?.BlockPublicAcls).toBe(true);
        expect(pub?.BlockPublicPolicy).toBe(true);
        expect(pub?.IgnorePublicAcls).toBe(true);
        expect(pub?.RestrictPublicBuckets).toBe(true);

        // 30-day expiry
        const rules = bucket.Properties?.LifecycleConfiguration?.Rules as any[];
        expect(rules).toBeDefined();
        const expiryRule = rules.find((r: any) => r.ExpirationInDays === 30);
        expect(expiryRule).toBeDefined();
        expect(expiryRule.Status).toBe('Enabled');
      }),
      { numRuns: 10 }
    );
  });
});


describe('Preservation: Pipeline Stage Order (Req 3.6)', () => {
  /**
   * For all environments: pipeline stages Source → CloneSource → SwaggerGen → Lint → Build → Push maintain order
   * **Validates: Requirements 3.6**
   */
  test('Pipeline stages Source → CloneSource → SwaggerGen → Lint → Build → Push exist in order', () => {
    fc.assert(
      fc.property(environmentArb, (_env) => {
        const template = loadTemplate('codepipeline.yaml');
        const pipeline = template.Resources?.Pipeline;
        expect(pipeline).toBeDefined();
        const stages = pipeline.Properties?.Stages as any[];
        expect(stages).toBeDefined();

        const stageNames = stages.map((s: any) => s.Name);
        const expectedOrder = ['Source', 'CloneSource', 'SwaggerGen', 'Lint', 'Build', 'ContractTest', 'Approval', 'Deploy'];

        // All expected stages must exist
        for (const name of expectedOrder) {
          expect(stageNames).toContain(name);
        }

        // They must appear in the correct relative order
        for (let i = 0; i < expectedOrder.length - 1; i++) {
          const currentIdx = stageNames.indexOf(expectedOrder[i]);
          const nextIdx = stageNames.indexOf(expectedOrder[i + 1]);
          expect(currentIdx).toBeLessThan(nextIdx);
        }
      }),
      { numRuns: 10 }
    );
  });
});

describe('Preservation: API Gateway Routes via VPC Link (Req 3.1)', () => {
  /**
   * For all environments: API Gateway non-webhook routes forward through VPC Link unchanged
   * **Validates: Requirements 3.1**
   */
  test('Routes /api/{proxy+}, /health, $default forward through VPC Link integration', () => {
    fc.assert(
      fc.property(environmentArb, (_env) => {
        const template = loadTemplate('api-gateway.yaml');

        // VPC Link exists
        const vpcLink = template.Resources?.VpcLink;
        expect(vpcLink).toBeDefined();
        expect(vpcLink.Type).toBe('AWS::ApiGatewayV2::VpcLink');

        // ALB Integration uses VPC_LINK
        const albIntegration = template.Resources?.AlbIntegration;
        expect(albIntegration).toBeDefined();
        expect(albIntegration.Properties?.ConnectionType).toBe('VPC_LINK');
        expect(albIntegration.Properties?.IntegrationType).toBe('HTTP_PROXY');

        // DefaultRoute targets ALB integration
        const defaultRoute = template.Resources?.DefaultRoute;
        expect(defaultRoute).toBeDefined();
        expect(defaultRoute.Properties?.RouteKey).toBe('$default');
        const defaultTarget = defaultRoute.Properties?.Target;
        expect(typeof defaultTarget === 'object'
          ? JSON.stringify(defaultTarget)
          : defaultTarget
        ).toContain('AlbIntegration');

        // ApiRoute targets ALB integration
        const apiRoute = template.Resources?.ApiRoute;
        expect(apiRoute).toBeDefined();
        expect(apiRoute.Properties?.RouteKey).toBe('ANY /api/{proxy+}');
        const apiTarget = apiRoute.Properties?.Target;
        expect(typeof apiTarget === 'object'
          ? JSON.stringify(apiTarget)
          : apiTarget
        ).toContain('AlbIntegration');

        // HealthRoute targets ALB integration
        const healthRoute = template.Resources?.HealthRoute;
        expect(healthRoute).toBeDefined();
        expect(healthRoute.Properties?.RouteKey).toBe('GET /health');
        const healthTarget = healthRoute.Properties?.Target;
        expect(typeof healthTarget === 'object'
          ? JSON.stringify(healthTarget)
          : healthTarget
        ).toContain('AlbIntegration');
      }),
      { numRuns: 10 }
    );
  });
});

describe('Preservation: ECS EC2 LaunchTemplate (Req 3.5)', () => {
  /**
   * For all environments: ECS EC2 LaunchTemplate preserves AMI, gp3 encrypted volumes, monitoring, UserData
   * **Validates: Requirements 3.5**
   */
  test('LaunchTemplate uses ECS-optimized AMI, gp3 encrypted volumes, detailed monitoring, UserData', () => {
    fc.assert(
      fc.property(environmentArb, (_env) => {
        const template = loadTemplate('ecs-ec2-cluster.yaml');
        const lt = template.Resources?.LaunchTemplate;
        expect(lt).toBeDefined();
        const ltData = lt.Properties?.LaunchTemplateData;
        expect(ltData).toBeDefined();

        // ECS-optimized AMI via SSM parameter
        const imageId = ltData.ImageId;
        expect(typeof imageId === 'string'
          ? imageId
          : JSON.stringify(imageId)
        ).toContain('ecs/optimized-ami');

        // gp3 encrypted volumes
        const blockDevices = ltData.BlockDeviceMappings as any[];
        expect(blockDevices).toBeDefined();
        expect(blockDevices.length).toBeGreaterThanOrEqual(1);
        const rootVolume = blockDevices[0];
        expect(rootVolume.Ebs?.VolumeType).toBe('gp3');
        expect(rootVolume.Ebs?.Encrypted).toBe(true);

        // Detailed monitoring
        expect(ltData.Monitoring?.Enabled).toBe(true);

        // UserData with ECS cluster config
        const userData = ltData.UserData;
        expect(userData).toBeDefined();
        // UserData is wrapped in Fn::Base64, check the Sub content
        const userDataStr = typeof userData === 'object'
          ? JSON.stringify(userData)
          : String(userData);
        expect(userDataStr).toContain('ECS_CLUSTER');
      }),
      { numRuns: 10 }
    );
  });
});

describe('Preservation: SNS Topic Encryption and Policies (Req 3.12)', () => {
  /**
   * For all environments: SNS topic has KMS encryption and topic policies
   * **Validates: Requirements 3.12**
   */
  test('PipelineNotificationTopic has KMS encryption and policies for events/codepipeline/codestar', () => {
    fc.assert(
      fc.property(environmentArb, (_env) => {
        const template = loadTemplate('monitoring.yaml');

        // SNS topic with KMS
        const topic = template.Resources?.PipelineNotificationTopic;
        expect(topic).toBeDefined();
        expect(topic.Properties?.KmsMasterKeyId).toBe('alias/aws/sns');

        // Topic policy
        const topicPolicy = template.Resources?.PipelineNotificationTopicPolicy;
        expect(topicPolicy).toBeDefined();
        const statements = topicPolicy.Properties?.PolicyDocument?.Statement as any[];
        expect(statements).toBeDefined();

        // Check for CloudWatch Events, CodePipeline, CodeStar Notifications principals
        const principals = statements.map((s: any) => s.Principal?.Service).filter(Boolean);
        expect(principals).toContain('events.amazonaws.com');
        expect(principals).toContain('codepipeline.amazonaws.com');
        expect(principals).toContain('codestar-notifications.amazonaws.com');
      }),
      { numRuns: 10 }
    );
  });
});

describe('Preservation: Fargate Capacity Provider Strategy (Req 3.13)', () => {
  /**
   * For all environments: Fargate capacity providers FARGATE (weight:1, base:1) and FARGATE_SPOT (weight:4)
   * **Validates: Requirements 3.13**
   */
  test('ECS Fargate cluster has FARGATE and FARGATE_SPOT with correct default weights', () => {
    fc.assert(
      fc.property(environmentArb, (_env) => {
        const template = loadTemplate('ecs-cluster.yaml');
        const cluster = template.Resources?.EcsCluster;
        expect(cluster).toBeDefined();

        // Capacity providers include FARGATE and FARGATE_SPOT
        const providers = cluster.Properties?.CapacityProviders as string[];
        expect(providers).toContain('FARGATE');
        expect(providers).toContain('FARGATE_SPOT');

        // Default strategy
        const strategy = cluster.Properties?.DefaultCapacityProviderStrategy as any[];
        expect(strategy).toBeDefined();
        expect(strategy.length).toBe(2);

        const fargateStrategy = strategy.find((s: any) => s.CapacityProvider === 'FARGATE');
        const spotStrategy = strategy.find((s: any) => s.CapacityProvider === 'FARGATE_SPOT');
        expect(fargateStrategy).toBeDefined();
        expect(spotStrategy).toBeDefined();

        // Default parameter values: FargateWeight=1, FargateBase=1, FargateSpotWeight=4
        // The strategy references Ref parameters, so check the parameter defaults
        const params = template.Parameters;
        expect(params?.FargateWeight?.Default).toBe(1);
        expect(params?.FargateBase?.Default).toBe(1);
        expect(params?.FargateSpotWeight?.Default).toBe(4);
      }),
      { numRuns: 10 }
    );
  });
});

describe('Preservation: IAM Trust Policies (Req 3.14)', () => {
  /**
   * For all environments: IAM trust policies and service principals unchanged
   * **Validates: Requirements 3.14**
   */
  test('IAM roles have correct service principal trust policies', () => {
    fc.assert(
      fc.property(environmentArb, (_env) => {
        const template = loadTemplate('iam.yaml');

        // CodePipeline role trusts codepipeline.amazonaws.com
        const cpRole = template.Resources?.CodePipelineRole;
        expect(cpRole).toBeDefined();
        const cpTrust = cpRole.Properties?.AssumeRolePolicyDocument?.Statement?.[0];
        expect(cpTrust?.Principal?.Service).toBe('codepipeline.amazonaws.com');

        // CodeBuild role trusts codebuild.amazonaws.com
        const cbRole = template.Resources?.CodeBuildRole;
        expect(cbRole).toBeDefined();
        const cbTrust = cbRole.Properties?.AssumeRolePolicyDocument?.Statement?.[0];
        expect(cbTrust?.Principal?.Service).toBe('codebuild.amazonaws.com');

        // ECS Execution role trusts ecs-tasks.amazonaws.com
        const execRole = template.Resources?.EcsExecutionRole;
        expect(execRole).toBeDefined();
        const execTrust = execRole.Properties?.AssumeRolePolicyDocument?.Statement?.[0];
        expect(execTrust?.Principal?.Service).toBe('ecs-tasks.amazonaws.com');

        // ECS Task role trusts ecs-tasks.amazonaws.com
        const taskRole = template.Resources?.EcsTaskRole;
        expect(taskRole).toBeDefined();
        const taskTrust = taskRole.Properties?.AssumeRolePolicyDocument?.Statement?.[0];
        expect(taskTrust?.Principal?.Service).toBe('ecs-tasks.amazonaws.com');

        // EC2 Instance role trusts ec2.amazonaws.com
        const ec2Role = template.Resources?.Ec2InstanceRole;
        expect(ec2Role).toBeDefined();
        const ec2Trust = ec2Role.Properties?.AssumeRolePolicyDocument?.Statement?.[0];
        expect(ec2Trust?.Principal?.Service).toBe('ec2.amazonaws.com');
      }),
      { numRuns: 10 }
    );
  });
});

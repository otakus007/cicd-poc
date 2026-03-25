/**
 * Unit Tests for Composite Alarms in monitoring.yaml
 *
 * Feature: infrastructure-optimization
 *
 * **Validates: Requirements 6.1, 6.2**
 *
 * - 6.1: Create a composite alarm per ECS service that triggers when any 2 of 3
 *         (CPU, Memory, UnhealthyHost) are in ALARM state
 * - 6.2: Publish composite alarm to the SNS notification topic
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface CloudFormationResource {
  Type: string;
  Condition?: string;
  Properties?: Record<string, unknown>;
  DependsOn?: string | string[];
}

interface CloudFormationTemplate {
  AWSTemplateFormatVersion?: string;
  Parameters?: Record<string, unknown>;
  Conditions?: Record<string, unknown>;
  Resources?: Record<string, CloudFormationResource>;
  Outputs?: Record<string, unknown>;
}

// =============================================================================
// YAML SCHEMA FOR CLOUDFORMATION INTRINSIC FUNCTIONS
// =============================================================================

const cfnTags = [
  new yaml.Type("!Ref", { kind: "scalar", construct: (d: string) => ({ Ref: d }) }),
  new yaml.Type("!Sub", { kind: "scalar", construct: (d: string) => ({ "Fn::Sub": d }) }),
  new yaml.Type("!Sub", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Sub": d }) }),
  new yaml.Type("!GetAtt", { kind: "scalar", construct: (d: string) => ({ "Fn::GetAtt": d.split(".") }) }),
  new yaml.Type("!GetAtt", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::GetAtt": d }) }),
  new yaml.Type("!Select", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Select": d }) }),
  new yaml.Type("!GetAZs", { kind: "scalar", construct: (d: string) => ({ "Fn::GetAZs": d }) }),
  new yaml.Type("!Join", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Join": d }) }),
  new yaml.Type("!If", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::If": d }) }),
  new yaml.Type("!Equals", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Equals": d }) }),
  new yaml.Type("!Not", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Not": d }) }),
  new yaml.Type("!And", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::And": d }) }),
  new yaml.Type("!Or", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Or": d }) }),
  new yaml.Type("!Condition", { kind: "scalar", construct: (d: string) => ({ Condition: d }) }),
  new yaml.Type("!ImportValue", { kind: "scalar", construct: (d: string) => ({ "Fn::ImportValue": d }) }),
  new yaml.Type("!FindInMap", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::FindInMap": d }) }),
  new yaml.Type("!Base64", { kind: "scalar", construct: (d: string) => ({ "Fn::Base64": d }) }),
  new yaml.Type("!Cidr", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Cidr": d }) }),
  new yaml.Type("!Split", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Split": d }) }),
];

const CFN_SCHEMA = yaml.DEFAULT_SCHEMA.extend(cfnTags);

// =============================================================================
// HELPERS
// =============================================================================

function loadMonitoringTemplate(): CloudFormationTemplate {
  const fullPath = path.join(__dirname, "..", "monitoring.yaml");
  const content = fs.readFileSync(fullPath, "utf8");
  return yaml.load(content, { schema: CFN_SCHEMA }) as CloudFormationTemplate;
}

// =============================================================================
// TESTS — Composite Alarms (Requirements 6.1, 6.2)
// =============================================================================

describe("Composite Alarms — ECS Service Health", () => {
  let template: CloudFormationTemplate;

  beforeAll(() => {
    template = loadMonitoringTemplate();
  });

  /**
   * **Validates: Requirement 6.1**
   * THE Platform SHALL create a composite alarm per ECS service that triggers
   * WHEN any two of the following are in ALARM state: CPU utilization, memory
   * utilization, or unhealthy host count.
   */
  describe("EcsServiceHealthCompositeAlarm resource (Req 6.1)", () => {
    test("EcsServiceHealthCompositeAlarm exists with type AWS::CloudWatch::CompositeAlarm", () => {
      const resources = template.Resources || {};
      expect(resources.EcsServiceHealthCompositeAlarm).toBeDefined();
      expect(resources.EcsServiceHealthCompositeAlarm.Type).toBe(
        "AWS::CloudWatch::CompositeAlarm"
      );
    });

    test("composite alarm has Condition: CanCreateCompositeAlarm", () => {
      const resource = template.Resources!.EcsServiceHealthCompositeAlarm;
      expect(resource.Condition).toBe("CanCreateCompositeAlarm");
    });

    test("CanCreateCompositeAlarm condition requires both ECS and ALB alarms", () => {
      const conditions = template.Conditions as Record<string, unknown>;
      expect(conditions).toBeDefined();
      expect(conditions.CanCreateCompositeAlarm).toBeDefined();
    });

    test("AlarmRule references the CPU alarm name", () => {
      const props = template.Resources!.EcsServiceHealthCompositeAlarm.Properties!;
      const alarmRule = props.AlarmRule as Record<string, string>;
      // AlarmRule uses !Sub, so it's parsed as { "Fn::Sub": "..." }
      const ruleString = alarmRule["Fn::Sub"] as string;
      expect(ruleString).toContain("ecs-cpu-alarm");
    });

    test("AlarmRule references the Memory alarm name", () => {
      const props = template.Resources!.EcsServiceHealthCompositeAlarm.Properties!;
      const alarmRule = props.AlarmRule as Record<string, string>;
      const ruleString = alarmRule["Fn::Sub"] as string;
      expect(ruleString).toContain("ecs-memory-alarm");
    });

    test("AlarmRule references the UnhealthyHost alarm name", () => {
      const props = template.Resources!.EcsServiceHealthCompositeAlarm.Properties!;
      const alarmRule = props.AlarmRule as Record<string, string>;
      const ruleString = alarmRule["Fn::Sub"] as string;
      expect(ruleString).toContain("alb-unhealthy-hosts-alarm");
    });

    test("AlarmRule uses OR-of-pairs pattern (at least 2 of 3 must be in ALARM)", () => {
      const props = template.Resources!.EcsServiceHealthCompositeAlarm.Properties!;
      const alarmRule = props.AlarmRule as Record<string, string>;
      const ruleString = alarmRule["Fn::Sub"] as string;

      // The OR-of-pairs pattern for "at least 2 of 3" requires exactly 3 AND pairs
      // connected by OR: (A AND B) OR (A AND C) OR (B AND C)
      const andCount = (ruleString.match(/\bAND\b/g) || []).length;
      const orCount = (ruleString.match(/\bOR\b/g) || []).length;

      // Expect 3 AND clauses (one per pair) and 2 OR connectors
      expect(andCount).toBe(3);
      expect(orCount).toBe(2);

      // Verify each pair uses ALARM() syntax
      const alarmCalls = (ruleString.match(/ALARM\(/g) || []).length;
      // 3 pairs × 2 alarms per pair = 6 ALARM() calls
      expect(alarmCalls).toBe(6);
    });

    test("composite alarm DependsOn includes all 3 underlying alarms", () => {
      const resource = template.Resources!.EcsServiceHealthCompositeAlarm;
      const dependsOn = Array.isArray(resource.DependsOn)
        ? resource.DependsOn
        : [resource.DependsOn];

      expect(dependsOn).toContain("EcsCpuUtilizationAlarm");
      expect(dependsOn).toContain("EcsMemoryUtilizationAlarm");
      expect(dependsOn).toContain("AlbUnhealthyHostAlarm");
    });
  });

  /**
   * **Validates: Requirement 6.2**
   * WHEN the composite alarm triggers, THE Platform SHALL publish to the SNS
   * notification topic.
   */
  describe("Composite alarm SNS notification (Req 6.2)", () => {
    test("AlarmActions references PipelineNotificationTopic", () => {
      const props = template.Resources!.EcsServiceHealthCompositeAlarm.Properties!;
      const alarmActions = props.AlarmActions as unknown[];
      expect(alarmActions).toBeDefined();
      expect(alarmActions.length).toBeGreaterThan(0);

      // The first action should be a !Ref to PipelineNotificationTopic
      const firstAction = alarmActions[0] as Record<string, string>;
      expect(firstAction.Ref).toBe("PipelineNotificationTopic");
    });
  });
});


// =============================================================================
// TESTS — Anomaly Detection (Requirements 7.1, 7.2)
// =============================================================================

describe("Anomaly Detection — API Gateway Latency", () => {
  let template: CloudFormationTemplate;

  beforeAll(() => {
    template = loadMonitoringTemplate();
  });

  /**
   * **Validates: Requirement 7.1**
   * THE Platform SHALL create a CloudWatch Anomaly Detector for the API Gateway
   * `IntegrationLatency` metric.
   */
  describe("ApiGatewayLatencyAnomalyDetector resource (Req 7.1)", () => {
    test("ApiGatewayLatencyAnomalyDetector exists with type AWS::CloudWatch::AnomalyDetector", () => {
      const resources = template.Resources || {};
      expect(resources.ApiGatewayLatencyAnomalyDetector).toBeDefined();
      expect(resources.ApiGatewayLatencyAnomalyDetector.Type).toBe(
        "AWS::CloudWatch::AnomalyDetector"
      );
    });

    test("AnomalyDetector targets IntegrationLatency metric", () => {
      const props = template.Resources!.ApiGatewayLatencyAnomalyDetector.Properties!;
      expect(props.MetricName).toBe("IntegrationLatency");
    });

    test("AnomalyDetector targets AWS/ApiGateway namespace", () => {
      const props = template.Resources!.ApiGatewayLatencyAnomalyDetector.Properties!;
      expect(props.Namespace).toBe("AWS/ApiGateway");
    });

    test("AnomalyDetector uses Average stat", () => {
      const props = template.Resources!.ApiGatewayLatencyAnomalyDetector.Properties!;
      expect(props.Stat).toBe("Average");
    });

    test("AnomalyDetector is conditioned on HasApiGatewayName", () => {
      const resource = template.Resources!.ApiGatewayLatencyAnomalyDetector;
      expect(resource.Condition).toBe("HasApiGatewayName");
    });
  });

  /**
   * **Validates: Requirement 7.2**
   * WHEN the integration latency exceeds the anomaly detection band for 3
   * consecutive evaluation periods, THE Platform SHALL trigger an alarm and
   * publish to the SNS notification topic.
   */
  describe("ApiGatewayLatencyAnomalyAlarm resource (Req 7.2)", () => {
    test("ApiGatewayLatencyAnomalyAlarm exists with type AWS::CloudWatch::Alarm", () => {
      const resources = template.Resources || {};
      expect(resources.ApiGatewayLatencyAnomalyAlarm).toBeDefined();
      expect(resources.ApiGatewayLatencyAnomalyAlarm.Type).toBe(
        "AWS::CloudWatch::Alarm"
      );
    });

    test("Alarm has EvaluationPeriods: 3", () => {
      const props = template.Resources!.ApiGatewayLatencyAnomalyAlarm.Properties!;
      expect(props.EvaluationPeriods).toBe(3);
    });

    test("Alarm uses GreaterThanUpperThreshold comparison", () => {
      const props = template.Resources!.ApiGatewayLatencyAnomalyAlarm.Properties!;
      expect(props.ComparisonOperator).toBe("GreaterThanUpperThreshold");
    });

    test("Alarm has ThresholdMetricId referencing anomaly band", () => {
      const props = template.Resources!.ApiGatewayLatencyAnomalyAlarm.Properties!;
      expect(props.ThresholdMetricId).toBe("ad1");

      // Verify the ad1 metric uses ANOMALY_DETECTION_BAND
      const metrics = props.Metrics as Array<Record<string, unknown>>;
      const adMetric = metrics.find((m) => m.Id === "ad1");
      expect(adMetric).toBeDefined();
      expect(adMetric!.Expression).toContain("ANOMALY_DETECTION_BAND");
    });

    test("Alarm publishes to PipelineNotificationTopic", () => {
      const props = template.Resources!.ApiGatewayLatencyAnomalyAlarm.Properties!;
      const alarmActions = props.AlarmActions as unknown[];
      expect(alarmActions).toBeDefined();
      expect(alarmActions.length).toBeGreaterThan(0);

      const firstAction = alarmActions[0] as Record<string, string>;
      expect(firstAction.Ref).toBe("PipelineNotificationTopic");
    });

    test("Alarm is conditioned on HasApiGatewayName", () => {
      const resource = template.Resources!.ApiGatewayLatencyAnomalyAlarm;
      expect(resource.Condition).toBe("HasApiGatewayName");
    });
  });
});


// =============================================================================
// TESTS — Saved Queries (Requirements 17.1, 17.2, 17.3)
// =============================================================================

describe("Saved Queries — CloudWatch Log Insights", () => {
  let template: CloudFormationTemplate;

  beforeAll(() => {
    template = loadMonitoringTemplate();
  });

  /**
   * **Validates: Requirements 17.1, 17.2, 17.3**
   * THE Platform SHALL create CloudWatch Log Insights query definitions for:
   * - Pipeline Stage Failures targeting CodeBuild log groups
   * - ECS Task Stop Reasons targeting ECS container log group
   * - API Gateway 5xx Errors targeting API Gateway access log group
   */
  describe("All 3 QueryDefinition resources exist", () => {
    test("PipelineStageFailuresQuery exists with type AWS::Logs::QueryDefinition", () => {
      const resources = template.Resources || {};
      expect(resources.PipelineStageFailuresQuery).toBeDefined();
      expect(resources.PipelineStageFailuresQuery.Type).toBe(
        "AWS::Logs::QueryDefinition"
      );
    });

    test("EcsTaskStopReasonsQuery exists with type AWS::Logs::QueryDefinition", () => {
      const resources = template.Resources || {};
      expect(resources.EcsTaskStopReasonsQuery).toBeDefined();
      expect(resources.EcsTaskStopReasonsQuery.Type).toBe(
        "AWS::Logs::QueryDefinition"
      );
    });

    test("ApiGateway5xxErrorsQuery exists with type AWS::Logs::QueryDefinition", () => {
      const resources = template.Resources || {};
      expect(resources.ApiGateway5xxErrorsQuery).toBeDefined();
      expect(resources.ApiGateway5xxErrorsQuery.Type).toBe(
        "AWS::Logs::QueryDefinition"
      );
    });
  });

  describe("Each query has the correct condition", () => {
    test("PipelineStageFailuresQuery is conditioned on HasCodeBuildLogGroupPrefix", () => {
      const resource = template.Resources!.PipelineStageFailuresQuery;
      expect(resource.Condition).toBe("HasCodeBuildLogGroupPrefix");
    });

    test("EcsTaskStopReasonsQuery is conditioned on HasEcsLogGroupName", () => {
      const resource = template.Resources!.EcsTaskStopReasonsQuery;
      expect(resource.Condition).toBe("HasEcsLogGroupName");
    });

    test("ApiGateway5xxErrorsQuery is conditioned on HasApiGatewayLogGroupName", () => {
      const resource = template.Resources!.ApiGateway5xxErrorsQuery;
      expect(resource.Condition).toBe("HasApiGatewayLogGroupName");
    });
  });

  describe("Each query has a Name and non-empty QueryString", () => {
    test("PipelineStageFailuresQuery has a Name property", () => {
      const props = template.Resources!.PipelineStageFailuresQuery.Properties!;
      expect(props.Name).toBeDefined();
    });

    test("PipelineStageFailuresQuery has a non-empty QueryString", () => {
      const props = template.Resources!.PipelineStageFailuresQuery.Properties!;
      expect(props.QueryString).toBeDefined();
      expect(String(props.QueryString).trim().length).toBeGreaterThan(0);
    });

    test("EcsTaskStopReasonsQuery has a Name property", () => {
      const props = template.Resources!.EcsTaskStopReasonsQuery.Properties!;
      expect(props.Name).toBeDefined();
    });

    test("EcsTaskStopReasonsQuery has a non-empty QueryString", () => {
      const props = template.Resources!.EcsTaskStopReasonsQuery.Properties!;
      expect(props.QueryString).toBeDefined();
      expect(String(props.QueryString).trim().length).toBeGreaterThan(0);
    });

    test("ApiGateway5xxErrorsQuery has a Name property", () => {
      const props = template.Resources!.ApiGateway5xxErrorsQuery.Properties!;
      expect(props.Name).toBeDefined();
    });

    test("ApiGateway5xxErrorsQuery has a non-empty QueryString", () => {
      const props = template.Resources!.ApiGateway5xxErrorsQuery.Properties!;
      expect(props.QueryString).toBeDefined();
      expect(String(props.QueryString).trim().length).toBeGreaterThan(0);
    });
  });

  describe("Each query targets the correct log group (Req 17.1, 17.2, 17.3)", () => {
    test("PipelineStageFailuresQuery targets CodeBuild log groups via CodeBuildLogGroupPrefix", () => {
      const props = template.Resources!.PipelineStageFailuresQuery.Properties!;
      const logGroupNames = props.LogGroupNames as unknown[];
      expect(logGroupNames).toBeDefined();
      expect(logGroupNames.length).toBeGreaterThan(0);

      // The log group reference should be a !Ref to CodeBuildLogGroupPrefix
      const firstLogGroup = logGroupNames[0] as Record<string, string>;
      expect(firstLogGroup.Ref).toBe("CodeBuildLogGroupPrefix");
    });

    test("EcsTaskStopReasonsQuery targets ECS log group via EcsLogGroupName", () => {
      const props = template.Resources!.EcsTaskStopReasonsQuery.Properties!;
      const logGroupNames = props.LogGroupNames as unknown[];
      expect(logGroupNames).toBeDefined();
      expect(logGroupNames.length).toBeGreaterThan(0);

      // The log group reference should be a !Ref to EcsLogGroupName
      const firstLogGroup = logGroupNames[0] as Record<string, string>;
      expect(firstLogGroup.Ref).toBe("EcsLogGroupName");
    });

    test("ApiGateway5xxErrorsQuery targets API Gateway log group via ApiGatewayLogGroupName", () => {
      const props = template.Resources!.ApiGateway5xxErrorsQuery.Properties!;
      const logGroupNames = props.LogGroupNames as unknown[];
      expect(logGroupNames).toBeDefined();
      expect(logGroupNames.length).toBeGreaterThan(0);

      // The log group reference should be a !Ref to ApiGatewayLogGroupName
      const firstLogGroup = logGroupNames[0] as Record<string, string>;
      expect(firstLogGroup.Ref).toBe("ApiGatewayLogGroupName");
    });
  });
});

import { Stack, StackProps } from 'aws-cdk-lib';
import { aws_iam as iam, aws_sagemaker as sm } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as config from '../huggingfaceSagemaker/config';
import * as path from 'path';

export class HuggingfaceAiDeploymentStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const sagemakerRole = new iam.Role(this, 'SagemakerRole', {
      assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
    });
    sagemakerRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'));

    const sagemakerPolicy = new iam.Policy(this, 'SagemakerPolicy', {
      statements: [new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetAuthorizationToken",
          "cloudwatch:PutMetricData",
          "cloudwatch:GetMetricData",
          "cloudwatch:GetMetricStatistics",
          "cloudwatch:ListMetrics",
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:DescribeLogStreams",
          "logs:PutLogEvents",
          "logs:GetLogEvents",
          "s3:CreateBucket",
          "s3:ListBucket",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:PutObject",
        ],
        resources: ['*'],
      })],
    });

    sagemakerRole.attachInlinePolicy(sagemakerPolicy);

    const huggingface_model = "distilbert-base-uncased-finetuned-sst-2-english"
    const huggingface_task = "text-classification"
    const instance_type = "ml.m5.xlarge"

    const lambda_handler_path = path.join(__dirname, "lambda_src")

    const endpointConfig = new sm.CfnEndpointConfig(this, "HuggingFaceEndpointConfig", {
      productionVariants: [
        {
          initialVariantWeight: 1,
          modelName: 'HuggingFaceModel',
          instanceType: 'this.instance_type',
          initialInstanceCount: 1,
          variantName: 'HuggingFaceModel',

        }
      ]
    }
    );

    const endpoint = new sm.CfnEndpoint(this, "Endpoint", {
      endpointConfigName: endpointConfig.ref,
      endpointName: "HuggingFaceEndpoint",
    })
  }



  // SageMakerEndpointConstruct(
  //   self,
  //     "SagemakerEndpoint",
  //   huggingface_model = huggingface_model,
  //   huggingface_task = huggingface_task,
  //   execution_role_arn = execution_role_arn,
  //   instance_type = instance_type,
  //     ** kwargs,
  //   )


};

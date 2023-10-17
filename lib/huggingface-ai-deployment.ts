import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { aws_iam as iam, aws_s3 as s3, aws_ecr as ecr, aws_apigateway as apigw } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as config from './config';
import * as sagemaker from '@aws-cdk/aws-sagemaker-alpha';

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
          "cloudwatch:PutMetricData",
          "cloudwatch:GetMetricData",
          "cloudwatch:GetMetricStatistics",
          "cloudwatch:ListMetrics",
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:DescribeLogStreams",
          "logs:PutLogEvents",
          "logs:GetLogEvents",
        ],
        resources: ['*'],
      })],
    });

    sagemakerRole.attachInlinePolicy(sagemakerPolicy);

    const model_name = 'distilbert-base-uncased-finetuned-sst-2-english';

    const s3Bucket = s3.Bucket.fromBucketName(this, 'S3Bucket', 'generative-ai-model-bucket-123874692351');
    const modelData = sagemaker.ModelData.fromBucket(s3Bucket, `${model_name}.tar.gz`);
    s3Bucket.grantReadWrite(sagemakerRole)

    const currentRegion = 'eu-central-1'

    const repositoryName = 'huggingface-pytorch-inference'
    const repositoryArn = `arn:aws:ecr:${currentRegion}:${config.region_dict[currentRegion]}:repository/${repositoryName}`
    const repository = ecr.Repository.fromRepositoryAttributes(this, 'HuggingFaceRepository', { repositoryArn, repositoryName });
    repository.grantPullPush(sagemakerRole)


    const image_tag = '1.13.1-transformers4.26.0-cpu-py39-ubuntu20.04'
    const image = sagemaker.ContainerImage.fromEcrRepository(repository, image_tag);

    const model = new sagemaker.Model(this, 'PrimaryContainerModel', {
      containers: [
        {
          image: image,
          modelData: modelData,
          environment: {
            HF_TASK: 'text-classification',
            MMS_DEFAULT_WORKERS_PER_MODEL: '1',
            HF_MODEL_ID: model_name,
          },
        }
      ],
      role: sagemakerRole
    });

    const endpointConfig = new sagemaker.EndpointConfig(this, 'EndpointConfig', {
      instanceProductionVariants: [
        {
          model: model,
          variantName: 'HuggingFaceModel',
          initialVariantWeight: 1,
        }
      ]
    });

    const endpoint = new sagemaker.Endpoint(this, 'Endpoint', { endpointConfig });

    const apigwRole = new iam.Role(this, 'ApiGatewayRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    });

    const apigwPolicy = new iam.Policy(this, 'ApiGatewayPolicy', {
      statements: [new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "sagemaker:InvokeEndpoint",
        ],
        resources: [endpoint.endpointArn]
      })],
    });

    apigwRole.attachInlinePolicy(apigwPolicy);

    const api = new apigw.RestApi(this, "ApiGateway", {
      deployOptions: {
        stageName: "prod",
        tracingEnabled: true,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: apigw.Cors.DEFAULT_HEADERS,
      },
    });
    
    const queue = api.root.addResource(model_name);
    queue.addMethod(
      "POST",
      new apigw.AwsIntegration({
        service: "runtime.sagemaker",
        path: `endpoints/${endpoint.endpointName}/invocations`,
        integrationHttpMethod: "POST",
        options: {
          credentialsRole: apigwRole,
          integrationResponses: [
            {
              statusCode: "200",
            },
          ],
        },
      }),
      { methodResponses: [{ statusCode: "200" }] }
    );

    new CfnOutput(this, 'ApgwEndpoint', { value: `${api.url}/${model_name}` });
  }

};

import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { aws_iam as iam, aws_sagemaker as sm, aws_s3 as s3, aws_ecr as ecr, aws_apigateway as apigw } from 'aws-cdk-lib';
// import * as apigwv2 from "@aws-cdk/aws-apigatewayv2-alpha";
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

    const s3Bucket = s3.Bucket.fromBucketName(this, 'S3Bucket', 'generative-ai-model-bucket');
    const modelData = sagemaker.ModelData.fromBucket(s3Bucket, 'distilbert-base-uncased-finetuned-sst-2-english.tar.gz');

    const currentRegion = 'eu-central-1'

    const repositoryName = 'huggingface-pytorch-inference'
    const repositoryArn = `arn:aws:ecr:${currentRegion}:${config.region_dict[currentRegion]}:repository/${repositoryName}`
    const repository = ecr.Repository.fromRepositoryAttributes(this, 'HuggingFaceRepository', { repositoryArn, repositoryName });

    const image = sagemaker.ContainerImage.fromEcrRepository(repository, '1.13.1-transformers4.26.0-cpu-py39-ubuntu20.04');

    const model = new sagemaker.Model(this, 'PrimaryContainerModel', {
      containers: [
        {
          image: image,
          modelData: modelData,
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

    const api = new apigw.RestApi(this, 'ApiGateway', {
      restApiName: 'ModelApi',
      description: 'ModelApi',
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: apigw.Cors.DEFAULT_HEADERS,
      },

    });

    const integration = new apigw.AwsIntegration({
      service: 'runtime.sagemaker',
      // action: 'InvokeEndpoint',
      path: `endpoints/${endpoint.endpointName}/invocations`,
      integrationHttpMethod: 'POST',
      options: {
        credentialsRole: apigwRole,
        integrationResponses: [
          {
            statusCode: '200',
          },
        ],
      }
    });

    api.root
      .addMethod('POST', integration);




    //     const integration = new AwsIntegration({
    //       service: "SageMakerRuntime",
    //       path: "endpoints/{endpointName}/invocations",
    //       integrationHttpMethod: "POST",
    //       options: {
    //         credentialsRole: Role.fromRoleArn(
    //           this,
    //           "Execution role",
    //           "<arn>"
    //         )
    //       }
    //     });


    // const postMethod = api.root
    //       .addResource(this.node.tryGetContext("serviceVersion"))
    //       .addResource("endpoints")
    //       .addResource("{endpointName}")
    //       .addResource("inferences")
    //       .addMethod("POST", integration);



    // const api = new apigwv2.HttpApi(this, "api", {
    //   corsPreflight: {
    //     allowHeaders: ["Content-Type"],
    //     allowMethods: [
    //       apigwv2.CorsHttpMethod.OPTIONS,
    //       apigwv2.CorsHttpMethod.POST,
    //     ],
    //     allowOrigins: ["*"],
    //   },
    // });

    //     new apigwv2.HttpStage(this, "api-stage", {
    //       httpApi: api,
    //       stageName: "prod",
    //       autoDeploy: true,
    //     });

    // new apigwv2.HttpIntegration(this, "api-integration", {
    //   httpApi: api,
    //   integrationType: apigwv2.HttpIntegrationType.AWS_PROXY,
    //   integrationUri: `endpoints/${endpoint.endpointName}/invocations` //endpoint.endpointArn
    // });

    new CfnOutput(this, 'EndpointName', { value: endpoint.endpointName });
    new CfnOutput(this, 'ApgwEndpoint', { value: api.url });

  }

};

import {S3Client, PutObjectCommand} from '@aws-sdk/client-s3';
import {AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand} from '@aws-sdk/client-athena';
// @ts-ignore
import parquetjs from 'parquetjs-lite';
import {v4 as uuidv4} from 'uuid';
import {DateTime} from 'luxon';
import {promises as fs} from 'fs';

const localstackConfig = {
    endpoint: 'http://localhost:4566',
    region: 'us-east-1',
    credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test'
    }
};

async function writeParquetFile(s3Client: S3Client, bucketName: string) {
    // Define schema
    const schema = new parquetjs.ParquetSchema({
        id: {type: 'UTF8'},
        event_time: {type: 'TIMESTAMP_MILLIS'},
        description: {type: 'UTF8'}
    });

    // Create test data
    const testData = {
        id: uuidv4(),
        event_time: DateTime.utc().toMillis(),
        description: 'test event'
    };

    // Write to temporary file
    const writer = await parquetjs.ParquetWriter.openFile(schema, '/tmp/test.parquet');
    await writer.appendRow(testData);
    await writer.close();

    // Upload to S3
    const fileContent = await fs.readFile('/tmp/test.parquet');
    try {
        await s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: `data/${uuidv4()}.parquet`,
            Body: fileContent
        }));
    } catch (e) {
        console.log(e);
    } finally {
        await fs.unlink('/tmp/test.parquet')
    }
}

async function queryData(athenaClient: AthenaClient, bucketName: string) {
    let dateString = DateTime.utc().plus({ days: 5 }).toFormat('yyyy-MM-dd HH:mm:ss.SSS');

    const query = `SELECT *
                   FROM test_db.timestamp_test
                   WHERE event_time < CAST('${dateString}' AS TIMESTAMP);`;
    const {QueryExecutionId} = await athenaClient.send(new StartQueryExecutionCommand({
        QueryString: query,
        ResultConfiguration: {
            OutputLocation: `s3://${bucketName}/query-results/`
        }
    }));

    // Wait for query completion
    while (true) {
        const {QueryExecution} = await athenaClient.send(new GetQueryExecutionCommand({
            QueryExecutionId
        }));

        const state = QueryExecution?.Status?.State;
        if (state === 'SUCCEEDED') {
            console.log('Query succeeded');
            break;
        }
        if (state === 'FAILED' || state === 'CANCELLED') {
            throw new Error(`Query failed: ${QueryExecution?.Status?.StateChangeReason}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

async function main() {
    const s3Client = new S3Client({...localstackConfig, forcePathStyle: true});
    const athenaClient = new AthenaClient(localstackConfig);
    const bucketName = 'test-bucket';

    await writeParquetFile(s3Client, bucketName);
    await queryData(athenaClient, bucketName);
}

main().catch(console.error);

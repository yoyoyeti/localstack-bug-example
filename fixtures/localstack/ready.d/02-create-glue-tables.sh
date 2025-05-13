#!/bin/bash

# Create the database in glue
awslocal glue create-database --database-input '{"Name": "test_db", "Description": "Mock database for testing"}'

# Create in Hive/Trino directly using HiveSQL and capture the query ID
QUERY_ID=$(awslocal athena start-query-execution \
    --query-string "CREATE DATABASE IF NOT EXISTS test_db;" \
    --result-configuration "OutputLocation=s3://test-bucket/" \
    | grep "QueryExecutionId" | cut -d'"' -f4)

# Function to check query status
check_query_status() {
    local query_id=$1
    local status=$(awslocal athena get-query-execution --query-execution-id "$query_id" \
        --query 'QueryExecution.Status.State' --output text)
    echo "$status"
}

# Wait for database creation to complete
MAX_ATTEMPTS=30
SLEEP_SECONDS=2
attempt=1

while [ $attempt -le $MAX_ATTEMPTS ]; do
    STATUS=$(check_query_status "$QUERY_ID")

    if [ "$STATUS" = "SUCCEEDED" ]; then
        echo "Database creation completed successfully"
        echo "Creating CloudFormation stack..."
        # Create the glue tables from CF stack only after database is confirmed ready
        awslocal cloudformation create-stack --stack-name mock-stack \
            --template-url https://test-bucket.s3.us-east-1.amazonaws.com/glue-resources.yml
        exit 0
    elif [ "$STATUS" = "FAILED" ] || [ "$STATUS" = "CANCELLED" ]; then
        echo "Database creation failed with status: $STATUS"
        exit 1
    fi

    echo "Waiting for database creation to complete... Status: $STATUS (attempt $attempt/$MAX_ATTEMPTS)"
    sleep $SLEEP_SECONDS
    ((attempt++))
done

echo "Timeout waiting for database creation"
exit 1

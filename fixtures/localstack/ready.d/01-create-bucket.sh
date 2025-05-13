#!/bin/bash

awslocal s3 mb s3://test-bucket

awslocal s3 cp /resources/glue-resources.yml s3://test-bucket/glue-resources.yml

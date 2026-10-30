#!/usr/bin/env bash
# Create or update what .github/workflows/publish.yml needs in AWS (account
# 133081291590, us-west-2): the role meshy-dsh-github-release, which only the main
# branch of meshy-dev/meshy-dsh can assume through GitHub OIDC (immutable subject,
# see `gh api repos/meshy-dev/meshy-dsh/actions/oidc/customization/sub`). It may read
# one secret: the npm token meshy-dcc-core also publishes with
# (meshy-dcc/release/npm-token), which that repository's scripts/release/aws/setup.sh
# stores and rotates.
#
#   AWS_PROFILE=SRE-133081291590 scripts/release/aws/setup.sh
#
# Safe to rerun.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export AWS_REGION=us-west-2
role=meshy-dsh-github-release

if aws iam get-role --role-name "$role" > /dev/null 2>&1; then
    aws iam update-assume-role-policy --role-name "$role" --policy-document "file://$here/trust-policy.json"
else
    aws iam create-role --role-name "$role" \
        --description "meshy-dsh npm publish workflow (GitHub OIDC, main only)" \
        --assume-role-policy-document "file://$here/trust-policy.json" > /dev/null
fi
aws iam put-role-policy --role-name "$role" --policy-name meshy-dsh-release \
    --policy-document "file://$here/permissions-policy.json"
echo "role $role is ready"


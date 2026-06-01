const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

if (!token) {
  throw new Error("Missing GH_TOKEN. Set ROADMAP_PROJECT_TOKEN as a repository secret.");
}

const projectOwner = process.env.ROADMAP_PROJECT_OWNER || "Pls-1q43";
const projectNumber = Number(process.env.ROADMAP_PROJECT_NUMBER || "1");
const repoFullName = process.env.ROADMAP_REPOSITORY || process.env.GITHUB_REPOSITORY || "Pls-1q43/Dibao";
const normalizedRepoFullName = normalizeNameWithOwner(repoFullName);
const featureLabel = process.env.FEATURE_REQUEST_LABEL || "enhancement";
const votesFieldName = process.env.VOTES_FIELD || "Votes";
const statusFieldName = process.env.STATUS_FIELD || "Status";
const plannedStatusName = process.env.PLANNED_STATUS || "Planned (soon)";
const doneStatusName = process.env.DONE_STATUS || "Done";
const graphqlUrl = process.env.GITHUB_GRAPHQL_URL || "https://api.github.com/graphql";

const [repoOwner, repoName] = repoFullName.split("/");

if (!repoOwner || !repoName) {
  throw new Error(`Invalid ROADMAP_REPOSITORY: ${repoFullName}`);
}

async function graphql(query, variables = {}) {
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "roadmap-sync",
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(JSON.stringify(payload.errors || payload, null, 2));
  }

  return payload.data;
}

async function getProject() {
  const data = await graphql(
    `query($owner: String!, $number: Int!) {
      user(login: $owner) {
        projectV2(number: $number) {
          id
          fields(first: 100) {
            nodes {
              __typename
              ... on ProjectV2FieldCommon {
                id
                name
                dataType
              }
              ... on ProjectV2SingleSelectField {
                id
                name
                dataType
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }`,
    { owner: projectOwner, number: projectNumber },
  );

  const project = data.user?.projectV2;
  if (!project) {
    throw new Error(`Project not found: ${projectOwner}/${projectNumber}`);
  }

  return project;
}

async function listProjectItems(projectId) {
  const items = [];
  let after = null;

  do {
    const data = await graphql(
      `query($projectId: ID!, $after: String) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100, after: $after) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                type
                content {
                  __typename
                  ... on Issue {
                    id
                    number
                    repository {
                      nameWithOwner
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { projectId, after },
    );

    const page = data.node.items;
    items.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  return items;
}

async function listFeatureIssues() {
  const issues = [];
  let after = null;

  do {
    const data = await graphql(
      `query($owner: String!, $name: String!, $label: String!, $after: String) {
        repository(owner: $owner, name: $name) {
          issues(
            first: 100
            after: $after
            labels: [$label]
            states: [OPEN, CLOSED]
            orderBy: { field: CREATED_AT, direction: ASC }
          ) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              number
              title
              state
              url
              labels(first: 50) {
                nodes {
                  name
                }
              }
              reactions(content: THUMBS_UP) {
                totalCount
              }
              repository {
                nameWithOwner
              }
            }
          }
        }
      }`,
      { owner: repoOwner, name: repoName, label: featureLabel, after },
    );

    const page = data.repository.issues;
    issues.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  return issues;
}

async function getEventIssue() {
  if (process.env.GITHUB_EVENT_NAME !== "issues" || !process.env.GITHUB_EVENT_PATH) {
    return null;
  }

  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH));
  if (!event.issue || event.issue.pull_request) {
    return null;
  }

  const data = await graphql(
    `query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        issue(number: $number) {
          id
          number
          title
          state
          url
          labels(first: 50) {
            nodes {
              name
            }
          }
          reactions(content: THUMBS_UP) {
            totalCount
          }
          repository {
            nameWithOwner
          }
        }
      }
    }`,
    { owner: repoOwner, name: repoName, number: event.issue.number },
  );

  return data.repository.issue;
}

async function readFile(path) {
  const { readFile: nodeReadFile } = await import("node:fs/promises");
  return nodeReadFile(path, "utf8");
}

function getField(project, name) {
  return project.fields.nodes.find((field) => field?.name === name);
}

function getStatusOption(statusField, name) {
  return statusField?.options?.find((option) => option.name === name);
}

function normalizeNameWithOwner(nameWithOwner) {
  return nameWithOwner.toLowerCase();
}

function hasFeatureLabel(issue) {
  return issue.labels.nodes.some((label) => label.name.toLowerCase() === featureLabel.toLowerCase());
}

async function addProjectItem(projectId, issueId) {
  const data = await graphql(
    `mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item {
          id
        }
      }
    }`,
    { projectId, contentId: issueId },
  );

  return data.addProjectV2ItemById.item.id;
}

async function deleteProjectItem(projectId, itemId) {
  await graphql(
    `mutation($projectId: ID!, $itemId: ID!) {
      deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
        deletedItemId
      }
    }`,
    { projectId, itemId },
  );
}

async function updateNumberField(projectId, itemId, fieldId, number) {
  await graphql(
    `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $number: Float!) {
      updateProjectV2ItemFieldValue(
        input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { number: $number }
        }
      ) {
        projectV2Item {
          id
        }
      }
    }`,
    { projectId, itemId, fieldId, number },
  );
}

async function updateSingleSelectField(projectId, itemId, fieldId, optionId) {
  await graphql(
    `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(
        input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { singleSelectOptionId: $optionId }
        }
      ) {
        projectV2Item {
          id
        }
      }
    }`,
    { projectId, itemId, fieldId, optionId },
  );
}

async function moveProjectItem(projectId, itemId, afterId) {
  await graphql(
    `mutation($projectId: ID!, $itemId: ID!, $afterId: ID) {
      updateProjectV2ItemPosition(input: { projectId: $projectId, itemId: $itemId, afterId: $afterId }) {
        clientMutationId
      }
    }`,
    { projectId, itemId, afterId },
  );
}

async function main() {
  const project = await getProject();
  const votesField = getField(project, votesFieldName);
  const statusField = getField(project, statusFieldName);
  const plannedStatus = getStatusOption(statusField, plannedStatusName);
  const doneStatus = getStatusOption(statusField, doneStatusName);

  if (!votesField) {
    throw new Error(`Project field not found: ${votesFieldName}`);
  }

  const items = await listProjectItems(project.id);
  const itemByIssueId = new Map(
    items
      .filter(
        (item) =>
          item.content?.__typename === "Issue" &&
          normalizeNameWithOwner(item.content.repository.nameWithOwner) === normalizedRepoFullName,
      )
      .map((item) => [item.content.id, item.id]),
  );

  const eventIssue = await getEventIssue();
  if (eventIssue && !hasFeatureLabel(eventIssue)) {
    const existingItemId = itemByIssueId.get(eventIssue.id);
    if (existingItemId) {
      await deleteProjectItem(project.id, existingItemId);
      console.log(`Removed non-feature issue #${eventIssue.number} from roadmap.`);
    }
  }

  const featureIssues = await listFeatureIssues();

  for (const issue of featureIssues) {
    let itemId = itemByIssueId.get(issue.id);
    const wasAdded = !itemId;

    if (!itemId) {
      itemId = await addProjectItem(project.id, issue.id);
      itemByIssueId.set(issue.id, itemId);
      console.log(`Added issue #${issue.number} to roadmap.`);
    }

    const votes = issue.reactions.totalCount;
    await updateNumberField(project.id, itemId, votesField.id, votes);

    if (statusField && plannedStatus && doneStatus && (wasAdded || issue.state === "CLOSED")) {
      const optionId = issue.state === "CLOSED" ? doneStatus.id : plannedStatus.id;
      await updateSingleSelectField(project.id, itemId, statusField.id, optionId);
    }
  }

  const sortedIssues = [...featureIssues].sort((left, right) => {
    const voteDelta = right.reactions.totalCount - left.reactions.totalCount;
    return voteDelta || left.number - right.number;
  });

  let afterId = null;
  for (const issue of sortedIssues) {
    const itemId = itemByIssueId.get(issue.id);
    if (!itemId) {
      continue;
    }

    await moveProjectItem(project.id, itemId, afterId);
    afterId = itemId;
  }

  console.log(`Synced ${featureIssues.length} feature request issue(s) to ${projectOwner}/${projectNumber}.`);
}

await main();

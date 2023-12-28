import dotenv from "dotenv";
dotenv.config();

import util from "util";
import { createClient } from "@supabase/supabase-js";

const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID;
const PLAID_SECRET = process.env.PLAID_SECRET;
const PLAID_ENV = process.env.PLAID_ENV || "sandbox";

import {
  Configuration,
  PlaidApi,
  Products,
  PlaidEnvironments,
  Transaction,
  RemovedTransaction,
} from "plaid";

const PLAID_PRODUCTS = (
  process.env.PLAID_PRODUCTS || Products.Transactions
).split(",");
const PLAID_COUNTRY_CODES = (process.env.PLAID_COUNTRY_CODES || "US").split(
  ","
);
const PLAID_REDIRECT_URI = process.env.PLAID_REDIRECT_URI || "";
const PLAID_ANDROID_PACKAGE_NAME = process.env.PLAID_ANDROID_PACKAGE_NAME || "";

const configuration = new Configuration({
  basePath: PlaidEnvironments[PLAID_ENV],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": PLAID_CLIENT_ID,
      "PLAID-SECRET": PLAID_SECRET,
      "Plaid-Version": "2020-09-14",
    },
  },
});

const client = new PlaidApi(configuration);

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  db: {
    schema: "private",
  },
});

const prettyPrintResponse = (response: any) => {
  console.log(util.inspect(response.data, { colors: true, depth: 4 }));
};

await main();

async function getItems() {
  return (await supabase.from("items").select("*")).data;
}

async function listAccounts(item: any) {
  console.log(item.name);
  const accounts = (
    await client.accountsGet({
      access_token: item.access_token,
    })
  ).data;
  console.log(accounts);
}

async function updateTranactions(transations: Transaction[]) {
  for (const transaction of transations) {
    const { data, error } = await supabase.from("transactions").upsert({
      transaction_id: transaction.transaction_id,
      account_id: transaction.account_id,
      amount: transaction.amount,
      category: "",
      date: transaction.date,
      extra: JSON.stringify(transaction, null, 2),
      name: transaction.name,
    });
    if (error) console.log(error);
  }
}

async function deleteTransactions(transations: RemovedTransaction[]) {
  for (const transaction of transations) {
    const { data, error } = await supabase.from("transactions").upsert({
      transaction_id: transaction.transaction_id,
      deleted: true,
    });

    if (error) console.log(error);
  }
}

async function processItem(item: any) {
  console.log("Processing item ", item.name);

  let added: Transaction[] = [];
  let modified: Transaction[] = [];
  let removed: RemovedTransaction[] = [];

  let cursor: string | undefined = await getCursor(item.item_id);
  let hasMore = true;
  // Iterate through each page of new transaction updates for item
  while (hasMore) {
    const request = {
      access_token: item.access_token,
      cursor: cursor,
    };
    const response = await client.transactionsSync(request);
    const data = response.data;
    // Add this page of results
    added = added.concat(data.added.filter((t) => t.date >= "2023-12-01"));
    modified = modified.concat(
      data.modified.filter((t) => t.date >= "2023-12-01")
    );
    removed = removed.concat(data.removed);
    hasMore = data.has_more;
    // Update cursor to the next cursor
    cursor = data.next_cursor;
    console.log("cursor ", cursor);
  }
  await updateTranactions(added);
  console.log("added ", added.length);
  await deleteTransactions(removed);
  console.log("removed ", removed.length);
  await updateTranactions(modified);
  console.log("modified ", modified.length);

  console.log("Processing item completed");
  await setCursor(item.item_id, cursor);
}

async function getCursor(item_id: string) {
  const { data, error } = await supabase
    .from("cursors")
    .select()
    .eq("item_id", item_id);

  if (!data) return undefined;
  if (!data[0]) return undefined;

  return data[0].value;
}

async function setCursor(item_id: string, value: string | undefined) {
  if (!value) return;
  const { error } = await supabase
    .from("cursors")
    .upsert({ item_id: item_id, value: value });
}

async function main() {
  console.log("Start");

  const items = await getItems();

  if (!items) {
    console.log("no items");
    return;
  }

  for (const item of items) {
    //await listAccounts(item)
    await processItem(item);
  }

  console.log("End");
}

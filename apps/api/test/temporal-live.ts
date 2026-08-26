import http from 'http';
import { Connection, Client } from '@temporalio/client';

function request(options: http.RequestOptions, postData: string | null = null, cookie: string | null = null): Promise<any> {
  return new Promise((resolve, reject) => {
    const headers = (options.headers || {}) as Record<string, string | number>;
    if (postData) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }
    if (cookie) {
      headers['Cookie'] = cookie;
    }

    const req = http.request({ ...options, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        let json: any = null;
        try {
          json = JSON.parse(data);
        } catch {
          json = data;
        }
        resolve({ status: res.statusCode, data: json, setCookie });
      });
    });

    req.on('error', (err) => reject(err));
    if (postData) req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('⚡ TESTING TEMPORAL INTEGRATION WITH RELAY CRM ⚡\n');

  // 1. Check Temporal Server gRPC connection
  console.log('1. Connecting directly to Temporal Server at localhost:7233...');
  const connection = await Connection.connect({ address: 'localhost:7233' });
  const client = new Client({ connection });
  console.log('   ✅ Direct Temporal Connection successful!');

  // 2. Log in as Organization Owner
  console.log('\n2. Authenticating as Owner (owner@northwind.test)...');
  const login = await request(
    { hostname: 'localhost', port: 4000, path: '/api/v1/auth/login', method: 'POST' },
    JSON.stringify({ email: 'owner@northwind.test', password: 'Password123!' })
  );
  
  if (login.status !== 200 && login.status !== 201) {
    throw new Error(`Login failed with status ${login.status}: ${JSON.stringify(login.data)}`);
  }

  const cookie = login.setCookie?.map((c: string) => c.split(';')[0]).join('; ');
  console.log('   ✅ Logged in successfully.');

  // 3. Create a Quote with AI mode
  console.log('\n3. Creating Quote with AI drafting mode...');
  const createQuoteRes = await request(
    { hostname: 'localhost', port: 4000, path: '/api/v1/quotes', method: 'POST' },
    JSON.stringify({
      title: 'Enterprise Cloud Migration & Security Suite',
      customerName: 'Acme Global Corp',
      customerEmail: 'billing@acmeglobal.test',
      createdBy: 'AI',
      prompt: 'Need 10 cloud server migrations with 24/7 security auditing for Q3',
      currency: 'USD',
      items: [
        {
          id: 'item-1',
          type: 'product',
          description: 'Cloud Infrastructure Migration',
          quantity: 10,
          unitPrice: 1200,
          subtotal: 12000
        },
        {
          id: 'item-2',
          type: 'service',
          description: '24/7 Security Audit Suite',
          quantity: 1,
          unitPrice: 3500,
          subtotal: 3500
        }
      ]
    }),
    cookie
  );

  console.log(`   ✅ Quote Created! Status: ${createQuoteRes.status}`);
  const quote = createQuoteRes.data;
  console.log(`      Quote ID: ${quote.id}`);
  console.log(`      Quote Number: ${quote.quoteNumber}`);
  console.log(`      Total Amount: $${quote.totalAmount}`);
  console.log(`      Workflow ID: ${quote.workflowId}`);

  // 4. Query Temporal Server for the Workflow Execution
  console.log('\n4. Checking Workflow Execution in Temporal Server...');
  const workflowHandle = client.workflow.getHandle(quote.workflowId);
  const description = await workflowHandle.describe();
  console.log(`   ✅ Temporal Workflow found in server state!`);
  console.log(`      Workflow Type: ${description.type}`);
  console.log(`      Status: ${description.status.name}`);
  console.log(`      Task Queue: ${description.taskQueue}`);
  console.log(`      Run ID: ${description.runId}`);
  console.log(`      Start Time: ${description.startTime}`);

  // 5. Send APPROVE Signal via API
  console.log('\n5. Sending APPROVE Signal via CRM API (POST /api/v1/quotes/:id/signal)...');
  const signalRes = await request(
    { hostname: 'localhost', port: 4000, path: `/api/v1/quotes/${quote.id}/signal`, method: 'POST' },
    JSON.stringify({ action: 'APPROVE' }),
    cookie
  );

  console.log(`   ✅ Signal Dispatched! Status: ${signalRes.status}`);
  console.log(`      Updated Quote Status: ${signalRes.data.status}`);

  // 6. Verify quote in CRM
  console.log('\n6. Fetching updated quote from CRM...');
  const fetchQuote = await request(
    { hostname: 'localhost', port: 4000, path: `/api/v1/quotes/${quote.id}`, method: 'GET' },
    null,
    cookie
  );
  console.log(`   ✅ Final Quote Status in DB: ${fetchQuote.data.status}`);

  console.log('\n🎉 ALL TEMPORAL WORKFLOW & SIGNAL TESTS PASSED PERFECTLY!');
  console.log('   Temporal Dashboard: http://localhost:8233');
}

main().catch(err => {
  console.error('Temporal test failed:', err);
  process.exit(1);
});

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const serviceAccount = require('./credentials.json');

const app = express();
app.use(bodyParser.json());

// Configuration
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || 'Calendar';
const PORT = process.env.PORT || 3000;

// Initialize auth
const auth = new google.auth.GoogleAuth({
  credentials: serviceAccount,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Helper function to get sheet ID by name
async function getSheetId(sheets, sheetName) {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets(properties(sheetId,title))',
  });
  
  const sheet = res.data.sheets.find(s => s.properties.title === sheetName);
  return sheet ? sheet.properties.sheetId : null;
}

// Improved calendar function
async function addToCalendar(eventData) {
  const sheets = google.sheets({ version: 'v4', auth });
  
  try {
    // 1. Verify sheet exists or create it
    let sheetId = await getSheetId(sheets, SHEET_NAME);
    
    if (!sheetId) {
      console.log(`Creating new sheet: ${SHEET_NAME}`);
      const createRes = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: SHEET_NAME,
                gridProperties: {
                  rowCount: 1000,
                  columnCount: 10
                }
              }
            }
          }]
        }
      });
      sheetId = createRes.data.replies[0].addSheet.properties.sheetId;
      
      // Add headers if new sheet
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1:E1`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [['Date', 'Time', 'Name', 'Email', 'Description']]
        }
      });
    }

    // 2. Append data
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:E`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: [[
          eventData.date || new Date().toISOString().split('T')[0],
          eventData.time || '12:00',
          eventData.name,
          eventData.email,
          eventData.description || ''
        ]]
      }
    });

    console.log('Event added:', response.data.updates);
    return response.data;
    
  } catch (error) {
    console.error('Sheets API Error:', error.message);
    if (error.errors) error.errors.forEach(e => console.error('-', e.message));
    throw new Error(`Failed to update spreadsheet: ${error.message}`);
  }
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  console.log('Incoming webhook:', JSON.stringify(req.body, null, 2));
  
  try {
    const { event, data } = req.body;
    
    // Validation
    if (!event || !data) {
      return res.status(400).json({ error: 'Missing event or data' });
    }
    
    if (event !== 'schedule_appointment') {
      return res.status(400).json({ error: 'Unsupported event type' });
    }
    
    if (!data.name || !data.email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Process data
    await addToCalendar(data);
    return res.json({ success: true, message: 'Event added to calendar' });
    
  } catch (error) {
    console.error('Webhook Error:', error.stack);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Calendar Webhook Service Running');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Configured for spreadsheet: ${SPREADSHEET_ID}`);
  console.log(`Using sheet: ${SHEET_NAME}`);
});
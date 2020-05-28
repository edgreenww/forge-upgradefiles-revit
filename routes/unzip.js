const express = require('express');

let router = express.Router();

///////////////////////////////////////////////////////////////////////
/// Middleware for obtaining a token for each request.
///////////////////////////////////////////////////////////////////////
router.use(async (req, res, next) => {
    const oauth = new OAuth(req.session);
    let credentials = await oauth.getInternalToken();

    let oauth_client = oauth.getClient();

    let incomingCreds = {
        "client_id" : req.body.client_id,
        "client_secret" : req.body.client_secret,

    }
    console.log('credentials', credentials)
    if (incomingCreds.client_id){
        console.log("Using incoming credentials...")
        credentials = incomingCreds
    }
    // let oauth_client2 = oauth.getClientOurWay(req.scopes, incomingCreds);
    console.log('oauth_client', oauth_client)
    req.oauth_client = oauth_client;
    req.oauth_token = credentials;
    next();
});


///////////////////////////////////////////////////////////////////////
/// NEW ROUTE - upgrade revit file to specified version using Design Automation 
/// for Revit API - python call version
///////////////////////////////////////////////////////////////////////
router.get('/da4revit/v1/upgrader/files/unzip', async (req, res, next) => {
    res.status(200).end("unzip endpoint called");
})

module.exports = router;
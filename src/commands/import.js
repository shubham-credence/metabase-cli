/* eslint-disable no-unused-vars */
/* eslint-disable array-callback-return */
/* eslint-disable dot-notation */
/* eslint-disable unicorn/consistent-destructuring */
/* eslint-disable camelcase */
/* eslint-disable one-var */
/* eslint-disable prefer-const */
/* eslint-disable import/no-dynamic-require */
/* eslint-disable unicorn/prefer-module */

const { Command } = require('@oclif/core');
const path = require('path');
const { prompt } = require('enquirer');
const fs = require('fs-extra');
const chalk = require('chalk');
const { cli } = require('cli-ux');
const _ = require('lodash')

const util = require(path.join(__dirname, '../util.js'));
const { setConsoleLog, initLogger, CredError } = require(path.join(__dirname, '../helper/logger.js'));

const logger = initLogger();
const { sendRequest, validateCredConfig, getMetabaseSessionID } = require(path.join(__dirname, '../helper/api-utils.js'));
setConsoleLog(Command);

async function checkExistance({ type: flag, dashOrQueName: name, sessionID }) {
    try {
        let APIURL = flag === 'Q' ? `${global.credConfig.metabase.url}/api/card` : `${global.credConfig.metabase.url}/api/dashboard`;
        let options = {
            headers: {
                'X-Metabase-Session': sessionID,
            },
        };
        let response;

        response = await sendRequest(null, options, 'GET', APIURL, `to get all the ${flag === 'Q' ? 'questions' : 'dashboards'}`);
        return response.find((x) => x.name === name);
    } catch (error) {
        error.name = 'Metabase API call failed';
        logger.error(`${error.stack ? error.stack : error}`);
        throw new Error(`Failed to check existance of ${flag === 'Q' ? 'question' : 'dashboard'} : ${name}`);
    }
}

async function CollectDBInfo({ sessionID }) {
    try {
        let APIURL = `${global.credConfig.metabase.url}/api/database`,
            options = {
                headers: {
                    'X-Metabase-Session': sessionID
                }
            },
            connectionInfo;

        logger.info('Fetching all the connections from the metabase');
        const { data: connectionList } = await sendRequest(null, options, 'GET', APIURL, "to get all the databases");
        logger.info(`Successfully fetched all the connected database connections`);

        const selectedConnection = await prompt([
            {
                type: 'select',
                name: 'id',
                message: 'Please select the database connection:',
                result: (connectionName) => {
                    const { id } = connectionList.find(({ name }) => name === connectionName);
                    return id;
                },
                choices: connectionList.reduce((a, db) => (!db.is_sample && a.push(db.name), a), [])
            }
        ]);

        APIURL = `${global.credConfig.metabase.url}/api/database/${selectedConnection.id}`;
        connectionInfo = await sendRequest(null, options, 'GET', APIURL, "to collect detailed information of selected database");
        logger.info(`Selected Database connection info ${JSON.stringify(connectionInfo)}`);
        return connectionInfo;
    } catch (error) {
        error.name = 'Metabase API call failed';
        logger.error(`${error.stack ? error.stack : error}`);
        throw new CredError('Failed to get the database info. Import failed');
    }
}

async function tagQuestion({ dashboardID, questionID: cardId, sessionID, selectedQueName }) {
    try {
        let APIURL = `${global.credConfig.metabase.url}/api/dashboard/${dashboardID}/cards`,
            payload = {
                cardId
            },
            options;

        options = {
            headers: {
                'X-Metabase-Session': sessionID
            },
            body: JSON.stringify(payload)
        };
        await sendRequest(null, options, 'POST', APIURL, `to tag question : ${selectedQueName.length > 25 ? `${selectedQueName.slice(0, 25)}...   ` : selectedQueName}`);
    } catch (error) {
        error.name = 'Metabase API call failed';
        logger.error(`${error.stack ? error.stack : error}`);
        throw new Error(`Failed to tag question`);
    }
}

async function tagQuestionWithTextBox({ dashboardID, data, sessionID }) {
    try {
        let APIURL = `${global.credConfig.metabase.url}/api/dashboard/${dashboardID}/cards`,
            options;

        options = {
            headers: {
                'X-Metabase-Session': sessionID
            },
            body: JSON.stringify(data)
        };
        await sendRequest(null, options, 'POST', APIURL, `Creating a Textbox Question: ${data.visualization_settings.text}`);
    } catch (error) {
        error.name = 'Metabase API call failed';
        logger.error(`${error.stack ? error.stack : error}`);
        throw new Error(`Failed to tag question`);
    }
}

async function publish({ type: flag, dashOrQueId: id, sessionID, name }) {
    try {
        let APIURL = flag === 'Q' ? `${global.credConfig.metabase.url}/api/card/${id}/public_link` : `${global.credConfig.metabase.url}/api/dashboard/${id}/public_link`,
            options = {
                headers: {
                    'X-Metabase-Session': sessionID
                }
            };
        await sendRequest(null, options, 'POST', APIURL, `to publish ${flag === 'Q' ? 'question' : 'dashboard'} : ${name.length > 25 ? `${name.slice(0, 25)}...   ` : name}`);
    } catch (error) {
        error.name = 'Metabase API call failed';
        logger.error(`${error.stack ? error.stack : error}`);
        throw new Error(`Failed to publish ${flag === 'Q' ? 'question' : 'dashboard'}`);
    }
}

async function importQuestion({ impdata, sessionID, tagging = false, dashboardID = null }) {
    try {
        let questionExistance,
            APIURL,
            options,
            createdQuestion = null,
            questionID;
        const {
            data: { name: selectedQueName, public_uuid },
            type
        } = impdata;

        logger.info(`Checking existance of the question : ${selectedQueName}`);
        questionExistance = await checkExistance({
            type,
            dashOrQueName: selectedQueName,
            sessionID
        });

        if (questionExistance) {
            // update the question
            questionID = questionExistance.id;
            logger.info(`Question ${selectedQueName} already exist. Updating ...`);
            APIURL = `${global.credConfig.metabase.url}/api/card/${questionID}`;
            options = {
                headers: {
                    'X-Metabase-Session': sessionID
                },
                body: JSON.stringify(impdata.data)
            };

            await sendRequest(null, options, 'PUT', APIURL, `to update question : ${selectedQueName.length > 25 ? `${selectedQueName.slice(0, 25)}...   ` : selectedQueName}`);
            logger.info(`Question : ${selectedQueName} updated successfully`);
        } else {
            // creating the question
            logger.info(`Creating Question : ${selectedQueName}`);
            APIURL = `${global.credConfig.metabase.url}/api/card`;
            options = {
                headers: {
                    'X-Metabase-Session': sessionID
                },
                body: JSON.stringify(impdata.data)
            };

            createdQuestion = await sendRequest(null, options, 'POST', APIURL, `to create question : ${selectedQueName.length > 25 ? `${selectedQueName.slice(0, 25)}...   ` : selectedQueName}`);
            questionID = createdQuestion.id;
            logger.info(`Question ${selectedQueName} created successfully`);
        }

        // update the size of the question


        if (tagging) {
            // tagging the question to the dashboard
            logger.info(`Tagging question ${selectedQueName} to the dashbard with id : ${dashboardID}`);
            await tagQuestion({
                dashboardID,
                questionID,
                sessionID,
                selectedQueName
            });
            logger.info(`Question ${selectedQueName} tagged successfully`);
        }

        // publishing the question
        if (!public_uuid || createdQuestion !== null) {
            logger.info(`Publishing Question ${selectedQueName}`);
            await publish({
                type,
                dashOrQueId: questionID,
                sessionID,
                name: selectedQueName
            });
            logger.info(`Question ${selectedQueName} published successfully`);
        }
    } catch (error) {
        if (error.name !== 'CredError' && error.message) throw new CredError(`${error.message}`);
        error.name = 'Metabase API call failed';
        logger.error(`${error.stack ? error.stack : error}`);
        throw new CredError('Failed to import question');
    }
}

async function prepareDashCardsUpdatePayload({ impDashQueList, sessionID, dashboardID }) {
    let APIURL = `${global.credConfig.metabase.url}/api/dashboard/${dashboardID}`, options, updatedCardList = [], paramsFromRemoteDashQue, paramsFromImpDashQue;

    options = {
        headers: {
            'X-Metabase-Session': sessionID
        }
    };

    const jsonResponse = await sendRequest(null, options, 'GET', APIURL, `Prepare dashboard cards update based on payload`);

    jsonResponse["ordered_cards"]?.forEach(question => {
        let impDashQueDetails = impDashQueList.find(x => x["name"] === question["card"]["name"])
        if (impDashQueDetails) {
            paramsFromRemoteDashQue = _.pick(question, ["id", "card_id"])
            paramsFromImpDashQue = _.pick(impDashQueDetails,
                [
                    "sizeX",
                    "series",
                    "collection_authority_level",
                    "col",
                    "parameter_mappings",
                    "visualization_settings",
                    "sizeY",
                    "row"
                ])
            updatedCardList = [...updatedCardList, { ...paramsFromImpDashQue, ...paramsFromRemoteDashQue }]
        }
    });
    return updatedCardList;
}

async function importDashboard({ impdata, sessionID }) {
    try {
        let dashboardExistance, APIURL, payload, options, createParams, newDashboard, dashboardID;
        const {
            data: { name: selectedDashName, ordered_cards: questionsInImpdata },
            type
        } = impdata;

        logger.info(`Checking existance of the dashboard : ${selectedDashName}`);
        dashboardExistance = await checkExistance({
            type,
            dashOrQueName: selectedDashName,
            sessionID
        });

        options = {
            headers: {
                'X-Metabase-Session': sessionID
            },
        };
        // Deleting existing dashboard
        if (dashboardExistance) {
            try {
                dashboardID = dashboardExistance.id;
                logger.info(`Dashboard already exist in metabase. Deleting dashboard...`);
                APIURL = `${global.credConfig.metabase.url}/api/dashboard/${dashboardID}`;
                cli.action.start(`${chalk.greenBright(' ')} Processing request to delete dashboard : ${selectedDashName.length > 25 ? `${selectedDashName.slice(0, 25)}...   ` : selectedDashName}`, '', { stdout: true });
                await sendRequest(null, options, 'DELETE', APIURL, `Processing request to delete dashboard : ${selectedDashName.length > 25 ? `${selectedDashName.slice(0, 25)}...   ` : selectedDashName}`);
                cli.action.stop('Done');
                logger.info(`Dashboard : ${selectedDashName} deleted successfully`);
            } catch (error) {
                error.name = 'Metabase API call failed';
                logger.error(`${error.stack ? error.stack : error}`);
                throw new CredError('Failed to delete the existing dashboard.');
            }
        }

        // creating new dashboard
        createParams = ['can_write', 'enable_embedding', 'collection_id', 'show_in_getting_started', 'name', 'parameters', 'public_uuid', 'points_of_interest'];

        logger.info(`Creating a new dashboard : ${selectedDashName}`);
        APIURL = `${global.credConfig.metabase.url}/api/dashboard`;
        payload = {};
        Object.keys(impdata.data).map((key) => {
            if (createParams.includes(key)) {
                payload[key] = impdata.data[key];
            }
        });

        options['body'] = JSON.stringify(payload);
        newDashboard = await sendRequest(null, options, 'POST', APIURL, `to create dashboard : ${selectedDashName.length > 25 ? `${selectedDashName.slice(0, 25)}...   ` : selectedDashName}`);
        dashboardID = newDashboard.id;
        logger.info(`Dashboard : ${selectedDashName} created successfully`);
        // importing all the questions
        logger.info(`Importing all the question dashboard : ${selectedDashName}`);
        await Promise.all(questionsInImpdata.map(async questionData => {
            if (Object.keys(questionData.card).length > 1) {
                importQuestion({ impdata: { data: questionData.card, type: 'Q' }, sessionID, tagging: true, dashboardID })
            } else if (Object.keys(questionData.card).length == 1 && questionData.card_id === null) {
                tagQuestionWithTextBox({ dashboardID, data: questionData, sessionID });
            }
        }
        )).catch(error => {
            throw new Error(`Failed to import questions to the dashboard: ${selectedDashName} `);
        });
        logger.info('All the questions are imported successfully');

        // updating all the questions imported in the dashboard
        const cards = await prepareDashCardsUpdatePayload({ impDashQueList: questionsInImpdata.map(item => ({ ...item, name: item["card"]["name"] })), sessionID, dashboardID })

        if (cards.length > 0) {
            logger.info("Updating all the imported question in dashboard to fix sizes and location")
            APIURL = `${global.credConfig.metabase.url}/api/dashboard/${dashboardID}/cards`;
            options = {
                headers: {
                    'X-Metabase-Session': sessionID
                },
                body: JSON.stringify({ cards })
            };
            await sendRequest(null, options, 'PUT', APIURL, `to fix sizes and location of imported questions in dashboard`);
            logger.info("Successfully updated all the questions imported in dashboard")
        }

        // publishing newly created dashboard
        logger.info(`Publishing dashboard: ${selectedDashName} `);
        await publish({
            type,
            dashOrQueId: dashboardID,
            sessionID,
            name: selectedDashName
        });
        logger.info('Dashboard published successfully');
    } catch (error) {
        if (error.name !== 'CredError' && error.message) throw new CredError(`${error.message} `);
        error.name = 'Metabase API call failed';
        logger.error(`${error.stack ? error.stack : error} `);
        throw new CredError('Dashboard import failed.');
    }
}

function updateDatabaseId({ currentObj, currentSeleDBID }) {
    logger.info(`updateDatabaseId - CurrenObj Length - ${Object.keys(currentObj).length}`)
    if (Object.keys(currentObj).length > 1) {
        if (!currentObj.database_id || !currentObj.dataset_query) {
            logger.error(`Can not find database_id or database in dataset_query property in provide json body ${currentObj} `)
            throw new CredError("Required properties doesn't exist in json file.")
        }
        return { ...currentObj, database_id: currentSeleDBID, dataset_query: { ...currentObj.dataset_query, database: currentSeleDBID } }
    }
    return currentObj
}

class ImportCommand extends Command {
    async run() {
        try {
            let dbInfo, impdata, sessionID, updatedCardsList;

            await validateCredConfig('metabase', 'Metabase not initialised.');

            logger.info('Checking user sesssion');
            sessionID = await getMetabaseSessionID();
            logger.info(`Session check successful.Retrieved session id is: ${sessionID} `);

            const directory = await prompt([
                {
                    type: 'input',
                    name: 'jsonFilePath',
                    message: 'Please enter path to the json file you want to import',
                    initial: path.resolve('./'),
                    result: (input) => {
                        return path.resolve(input);
                    },
                },
            ]);

            if (!fs.existsSync(directory.jsonFilePath) || path.extname(directory.jsonFilePath) !== '.json') {
                logger.info(`Provided json file path: ${directory.jsonFilePath} `);
                throw new CredError('Provided a valid path to the json file.', {
                    suggestions: [`Run command ${chalk.yellowBright(`metabase import`)} `],
                });
            }

            // This is not necessary because we only gonna have one database to work with.
            dbInfo = await CollectDBInfo({ sessionID });
            if (!dbInfo.id) {
                throw new CredError('Please select valid database connection.');
            }

            const { id: currentSeleDBID } = dbInfo;
            impdata = JSON.parse(fs.readFileSync(directory.jsonFilePath));
            if (!impdata.data) {
                throw new CredError('Data property does not exist in the provided json file.');
            }

            if (impdata.type === 'Q') {
                // replacing database id by the one selected by user
                impdata = {
                    ...impdata,
                    data: updateDatabaseId({ currentObj: impdata.data, currentSeleDBID }),
                };
                logger.info(`Importing Question ${impdata.typename} `);
                await importQuestion({ impdata, sessionID });
            } else {
                // replacing database id by the one selected by user
                updatedCardsList = impdata.data.ordered_cards.map((item) => {
                    const updatedCard = updateDatabaseId({
                        currentObj: item.card,
                        currentSeleDBID,
                    });
                    return { ...item, card: updatedCard };
                });
                impdata = {
                    ...impdata,
                    data: { ...impdata.data, ordered_cards: updatedCardsList },
                };
                logger.info(`Importing Dashboard ${impdata.typename} `);
                await importDashboard({ impdata, sessionID });
            }

            logger.info(`Import successful`);
            this.console.log(`Import successful`);
        } catch (error) {
            util.errorHandler(error);
        }
    }
}

ImportCommand.description = `Import metabase dashboard / question`;

ImportCommand.flags = {};

module.exports = ImportCommand;

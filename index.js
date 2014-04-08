"use strict";

var fs = require( 'fs' );
var jade = require( 'jade' );
var async = require( 'async' );

var configs = null;
var userFields = [
	"from",
	"to",
	"cc",
	"bcc",
	"replyTo",
	"subject",
	"html",
	"headers",
	"attachments",
	"envelope",
	"messageId",
	"encoding"
];

// convert the mail params passed to sendMail(), and convert to a mail object suitable for the internal mailer instance
function assembleMailerObject( mail, done ) {

	// error checking
	if ( !mail || !mail.from || !mail.to || !mail.template ) {
		done( 'mail object must contain from, to and template fields' );
		return;
	}

	// clamping
	if ( !mail.model ) {
		mail.model = {};
	}

	// from the mail object, generate a body and subject from the templates
	getTemplateParts( mail, function( err, parts ) {

		if ( !parts ) {
			parts = {};
		}

		if ( err ) {
			console.error( 'err in get template parts callback', err );
		}

		var body = parts.body || null;
		var subject = parts.subject || null;

		if ( !body ) {
			done( 'could not render email body' );
			return;
		}

		if ( !subject ) {
			done( 'could not render email subject' );
			return;
		}

		var sendObject = {
			html: body,
			subject: subject,
			generateTextFromHTML: true
		};

		// copy in fields if they exist in the input
		for ( var i = 0; i < userFields.length; i++ ) {
			var field = userFields[i];
			if ( mail[field] !== undefined ) {
				sendObject[field] = mail[field];
			}
		}

		// bye bye
		setImmediate( function() {
			done( null, sendObject );
		} );

	} );

}


function getTemplateParts( mail, done ) {

	async.parallel( {
		subject: function( done ) {
			render( mail, 'subject', done );
		},
		body: function( done ) {
			render( mail, 'body', done );
		}
	}, done );

};

function render( mail, template, done ) {

	var filename = configs.templateDir + "/" + mail.template + '/' + template + '.jade';

	mail.model.cache = true;

	jade.renderFile( filename, mail.model, done );

}

module.exports.init = function( params ) {

	params = params || {};

	if ( !params.mailer || !params.templateDir ) {
		return false;
	}

	// copy just the params we expect
	configs = {
		mailer: params.mailer,
		templateDir: params.templateDir
	};

	return true;
};


module.exports.sendMail = function( mail, callback ) {

	var sentObject = { body: null, subject: null };

	// wrap the callback in a execution break
	var _callback = function( error, object ) {
		if ( typeof callback === 'function' ) {

			if ( object ) {
				object.sendObject = sentObject;
			}
			setImmediate( function() {
				callback( error, object );
			} );

		}
	};

	// assemble the send object, and send
	assembleMailerObject( mail, function( error, sendObject ) {

		if ( error ) {
			_callback( error, null );
		}
		else if ( !sendObject ) {
			_callback( 'Unknown error generating send object', null );
		}
		else {
			sentObject.body = sendObject.html || null;
			sentObject.subject = sendObject.subject || null;

			configs.mailer.sendMail( sendObject, _callback );

		}

	} );

};

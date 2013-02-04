"use strict";

var configs = null;
var fs = require( 'fs' );
var promise_io = require( 'promised-io' );
var jade = require( 'jade' );
var templateCache = {};
var functionCache = {};
var functionCacheCallbacks = {};
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
function assembleMailerObject( mail, callback ) {

	// error checking
	if ( !mail || !mail.from || !mail.to || !mail.template ) {
		callback( 'mail object must contain from, to and template fields', null );
		return;
	}

	// clamping
	if ( !mail.model ) {
		mail.model = {};
	}

	// from the mail object, generate a body and subject from the templates
	getTemplateParts( mail, function ( body, subject ) {

		var sendObject = {
			html:                 body,
			subject:              subject,
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
		process.nextTick( function () {
			callback( null, sendObject );
		} );

	} );

}

// render all the templates and return the rendered strings to the callback
function getTemplateParts( mail, callback ) {

	// each template part returns a promise, create a single promise watching all the part promises
	var promise = promise_io.all( [
		getTemplatePart( mail, 'body' ),
		getTemplatePart( mail, 'subject' )
	] );

	// tracks if the callback has been called
	var callbackReady = true;

	// utility wrapper around the actual callback
	var callbackInternal = function ( body, subject ) {
		if ( callbackReady ) {
			process.nextTick( function () {
				callback( body, subject );
			} );
		}
		callbackReady = false;
	};

	// the template parts have 5 minutes to return, then the process is aborted
	var ttl = setTimeout( callbackInternal, 300, false, false );

	// once the promises have been resolved (or one rejected), kill the TTL and fire the callback
	promise_io.when( promise, function ( parts ) {

		// clear ttl
		clearTimeout( ttl );

		callbackInternal( parts[0], parts[1] );
	}, function () {

		// clear ttl
		clearTimeout( ttl );

		callbackInternal( false, false );
	} );


}

// renders the specified template using the provided mail object
function getTemplatePart( mail, template ) {

	var templateFile = configs.templateDir + "/" + mail.template + '/' + template + '.jade';
	var promise = new promise_io.Promise();
	var options = {
		cache:    true,
		filename: templateFile
	};
	var functionCacheKey = JSON.stringify( options ); // templates are actually compiled into a javascript function for rendering, and are cached here

	// get the contents of the template file
	var getContents = function ( callback ) {

		// the template file contents is cached, callback immediately
		if ( templateCache[templateFile] ) {

			callback( templateCache[templateFile] );

		}
		else {

			// no cache, see if the file exists
			fs.stat( templateFile, function ( err, stat ) {

				// no file, bad mojo
				if ( err || (stat && !stat.isFile()) ) {

					callback( false );

				}
				else {

					// there is a file, read it, cache it, callitbackit
					fs.readFile( templateFile, "utf8", function ( err, data ) {

						templateCache[templateFile] = data ? data : false;

						callback( templateCache[templateFile] );

					} );

				}

			} );
		}
	};

	// runs the cached, compiled template, and resolves the promise
	var executeCompiledTemplate = function () {

		// run the render function with the model, resolve on return value if the function returns, otherwise resolve false
		try {
			var rendered = functionCache[functionCacheKey] ? (functionCache[functionCacheKey])( mail.model || {} ) : false;
			promise.resolve( rendered ? rendered : false );
		}
		catch ( e ) {
			promise.resolve( false );
		}

	};

	// if the template function is cached, resolve promise immediately, otherwise, get the contents of the template, compile the function, cache it, then resolve the promise
	if ( functionCache[functionCacheKey] ) {

		executeCompiledTemplate();

	}
	else {

		// if there are no functionCacheCallbacks, we are the first in
		if ( !functionCacheCallbacks[functionCacheKey] ) {

			// make a place for callbacks on the function cache
			functionCacheCallbacks[functionCacheKey] = [];

			// make sure ours is in place immediately
			functionCacheCallbacks[functionCacheKey].push( executeCompiledTemplate );

			// get the template contents, compile the function, cache it, and then execute the compiled template function
			getContents( function ( template ) {

				functionCache[functionCacheKey] = jade.compile( template, options );

				// go through all the callbacks waiting for this compiled template, and call them
				for ( var i = 0; i < functionCacheCallbacks[functionCacheKey].length; i++ ) {
					process.nextTick( functionCacheCallbacks[functionCacheKey][i] );
				}

				// clear the callback storage entry
				functionCacheCallbacks[functionCacheKey] = false;

			} );
		}
		else {

			// some other code is already populating the functionCache, just wait here until that code is complete
			functionCacheCallbacks[functionCacheKey].push( executeCompiledTemplate );

		}


	}

	return promise;
}

module.exports.init = function ( params ) {

	params = params || {};

	if ( !params.mailer || !params.templateDir ) {
		return false;
	}

	// copy just the params we expect
	configs = {
		mailer:      params.mailer,
		templateDir: params.templateDir
	};

	return true;
};


module.exports.sendMail = function ( mail, callback ) {

	// wrap the callback in a execution break
	var _callback = function ( error, object ) {
		if ( typeof callback === 'function' ) {
			process.nextTick( function () {
				callback( error, object );
			} );
		}
	};

	// assemble the send object, and send
	assembleMailerObject( mail, function ( error, sendObject ) {

		if ( error ) {
			_callback( error, null );
		}
		else if ( !sendObject ) {
			_callback( 'Unknown error generating send object', null );
		}
		else {
			configs.mailer.sendMail( sendObject, _callback );
		}

	} );

};

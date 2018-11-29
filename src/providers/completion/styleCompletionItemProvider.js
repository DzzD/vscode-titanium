const vscode = require('vscode');
const SnippetString = vscode.SnippetString;
const Range = vscode.Range;
const _ = require('underscore');
const related = require('../../related');
const alloyAutoCompleteRules = require('./alloyAutoCompleteRules');
const completionItemProviderHelper = require('./completionItemProviderHelper');

/**
 * Alloy Style completion provider
*/
const StyleCompletionItemProvider = {

	/**
	 * Provide completion items
	 *
	 * @param {TextDocument} document active text document
	 * @param {Position} position caret position
	 *
	 * @returns {Thenable|Array}
	 */
	async provideCompletionItems(document, position) {
		const linePrefix = document.getText(new Range(position.line, 0, position.line, position.character));
		const prefixRange = document.getWordRangeAtPosition(position);
		const prefix = prefixRange ? document.getText(prefixRange) : null;

		if (!this.completions) {
			await this.loadCompletions();
		}

		// property value - foo: _ or foo: ba_
		if (/\s*\w+\s*:\s*[\w"'.]*$/.test(linePrefix)) {
			// first attempt Alloy rules (i18n, image etc.)
			let ruleResult;
			for (const rule of Object.values(alloyAutoCompleteRules)) {
				if (rule.regExp.test(linePrefix)) {
					ruleResult = await rule.getCompletions(linePrefix, position, prefix);
				}
			}
			if (ruleResult) {
				return ruleResult;
			} else {
				return this.getPropertyValueCompletions(linePrefix, prefix);
			}
			// property name - _ or fo_
		} else if (/^\s*\w*$/.test(linePrefix)) {
			return this.getPropertyNameCompletions(linePrefix, prefix, position, document);
			// class or id - ".foo_ or "#foo
		} else if (/^['"][.#]\w*$/.test(linePrefix)) {
			return this.getClassOrIdCompletions(linePrefix, prefix, position, document);
			// tag - "Wind_ or "_
		} else if (/^['"]\w*$/.test(linePrefix)) {
			return this.getTagCompletions(linePrefix, prefix);
		}
	},

	/**
     * Get class or ID completions
     *
     * @param {String} linePrefix line prefix text
     * @param {String} prefix word prefix text
     *
     * @returns {Thenable}
     */
	getClassOrIdCompletions(linePrefix, prefix) {
		return new Promise((resolve) => {
			const relatedFile = related.getTargetPath('xml');
			const fileName = relatedFile.split('/').pop();
			vscode.workspace.openTextDocument(relatedFile).then(document => {
				const completions = [];
				const values = [];
				let regex = /class="(.*?)"/g;
				if (/^['"]#\w*$/.test(linePrefix)) {
					regex = /id="(.*?)"/g;
				}
				let matches;
				while ((matches = regex.exec(document.getText())) !== null) {
					for (const value of matches[1].split(' ')) {
						if (value && value.length > 0 && !values.includes(value) && (!prefix || completionItemProviderHelper.matches(value, prefix))) {
							completions.push({
								label: value,
								kind: vscode.CompletionItemKind.Reference,
								detail: `${fileName}`
							});
							values.push(value);
						}
					}
				}
				resolve(completions);
			});
		});
	},

	/**
     * Get tag completions
     *
     * @param {String} linePrefix line prefix text
     * @param {String} prefix word prefix text
     *
     * @returns {Array}
     */
	getTagCompletions(linePrefix, prefix) {
		const completions = [];
		_.each(this.completions.alloy.tags, function (value, key) {
			if (!prefix || completionItemProviderHelper.matches(key, prefix)) {
				completions.push({
					label: key,
					kind: vscode.CompletionItemKind.Class,
					detail: value.apiName,
					insertText: new SnippetString(`${key}": {\n\t\${1}\t\n}`)
				});
			}
		});

		return completions;
	},

	/**
     * Get property name completions
	 *
     * @param {String} linePrefix line prefix text
     * @param {String} prefix word prefix text
     * @param {Position} position caret position
     * @param {TextDocument} document active text document
     *
     * @returns {Array}
     */
	getPropertyNameCompletions(linePrefix, prefix, position, document) {
		const parentObjName = this.getParentObjectName(position, document);
		const { properties, types } = this.completions.titanium;
		const innerProperties = {};
		const completions = [];

		// Lookup the property data
		const propertyData = properties[parentObjName];
		if (!propertyData) {
			return completions;
		}

		const propertyType = properties[parentObjName].type;
		const typeData = types[propertyType];
		if (typeData && typeData.properties && typeData.properties.length) {
			let completionProperty;
			if (properties[parentObjName]) {
				completionProperty = properties[parentObjName].type;
			}
			_.each(types[completionProperty].properties, innerKey => innerProperties[innerKey] = {});
		}

		const candidateProperties = _.isEmpty(innerProperties) ? properties : innerProperties;
		for (const property in candidateProperties) {
			if (!prefix || completionItemProviderHelper.matches(property, prefix)) {

				//
				// Object types
				//
				const jsObjectTypes = [ 'Font' ];
				if (jsObjectTypes.indexOf(properties[property].type) > -1) {
					completions.push({
						label: property,
						kind: vscode.CompletionItemKind.Property,
						insertText: new SnippetString(`${property}: {\n\t\${1}\t\n}`),

					});

					//
					// Value types
					//
				} else {
					completions.push({
						label: property,
						kind: vscode.CompletionItemKind.Property,
						insertText: `${property}: `
					});
				}
			}
		}
		return completions;
	},

	/**
	 * Get property value completions
	 *
	 * @param {String} linePrefix line prefix text
	 * @param {String} prefix word prefix text
	 *
	 * @returns {Array}
	 */
	getPropertyValueCompletions(linePrefix, prefix) {
		const { properties } = this.completions.titanium;
		let property;
		const matches = /^\s*(\S+)\s*:/.exec(linePrefix);
		if (matches && matches.length >= 2) {
			property = matches[1];
		}

		if (properties[property]) {
			return null;
		}

		const { values } = properties[property];
		if (!values) {
			return null;
		}

		const completions = [];
		for (const value of values) {
			if (!prefix || completionItemProviderHelper.matches(value, prefix)) {
				completions.push({
					label: value,
					kind: vscode.CompletionItemKind.Value
				});
			}
		}

		return completions;
	},

	/**
     * Get parent object name
     *
     * @param {Position} position caret position
     * @param {TextDocument} document active text document
     *
     * @returns {String}
     */
	getParentObjectName(position, document) {
		let lineNumber = position.line;
		while (lineNumber >= 0) {
			const line = document.lineAt(lineNumber).text;
			const regexResult = /^\s*(\S+)\s*:\s*\{/.exec(line);
			const propertyName = regexResult ? regexResult[1] : undefined;

			const parentNameIndex = (regexResult ? regexResult.index : undefined) || -1;
			if (parentNameIndex < line.lastIndexOf('}')) {
				return;
			}
			if (propertyName) {
				return propertyName;
			}
			lineNumber--;
		}
	},

	async loadCompletions() {
		this.completions = await completionItemProviderHelper.loadCompletions();
	}
};

module.exports = StyleCompletionItemProvider;

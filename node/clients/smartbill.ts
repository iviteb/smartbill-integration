/* eslint-disable  @typescript-eslint/no-explicit-any */
import type { InstanceOptions, IOContext } from '@vtex/api'
import SimpleCrypto from 'simple-crypto-js'
import { Apps, ExternalClient } from '@vtex/api'
import { validate } from 'validate.js'

import constants from '../constants';
import type { AddressForm, TaxName } from '../typings'
import {mergeArrays} from "../helpers";

export default class Smartbill extends ExternalClient {

  private static getBuffer(settings: any) {

    // Create buffer object, specifying utf8 as encoding
    const bufferObj = Buffer.from(
      `${settings.smarbillUsername}:${settings.smarbillApiToken}`,
      'utf8'
    )

    // Encode the Buffer as a base64 string
    return bufferObj.toString('base64')
  }

  public async generateJson(order: any, addressForm?: AddressForm) {
    const settings = await this.getSettings()

    const todayDate = new Date().toISOString().slice(0, 10)
    const {
      clientProfileData: client,
      shippingData: { address },
    } = order

    const clientEntity = await this.getClient(client.userProfileId)
    const email = clientEntity.length ? clientEntity[0].email : client.email

    const clientData: any = {
      country: constants.country,
      email,
      name: `${client.lastName} ${client.firstName}`,
      address: addressForm?.corporateAddress ? addressForm.corporateAddress : `${address.street} ${address.number}`,
      city: addressForm?.city ? addressForm.city : `${address.city}`,
      county: addressForm?.county ? addressForm.county : `${address.state}`,
    }


    if (client.isCorporate) {
      clientData.vatCode = client.corporateDocument
      clientData.name = client.tradeName
      clientData.regCom = client.stateInscription
    }

    const products = await this.generateProducts(order, settings)

    return {
      client: clientData,
      companyVatCode: settings.smarbillVatCode,
      issueDate: todayDate,
      products,
      seriesName: settings.smarbillSeriesName,
    }
  }

  public async getClient(userProfileId: any): Promise<any> {
    return this.http.get(
      `http://${this.context.account}.vtexcommercestable.com.br/api/dataentities/CL/search/?_fields=_all&_where=userId=${userProfileId}`,
      {
        headers: {
          VtexIdclientAutCookie: this.context.authToken,
        },
      }
    )
  }

  private async validateSettings() {
    const settings = await this.getSettings()
    const rule = {
      presence: { allowEmpty: false },
    }

    const constraints = {
      smarbillApiToken: rule,
      smarbillSeriesName: rule,
      smarbillUsername: rule,
      smarbillVatCode: rule,
    }

    return validate(settings, constraints, { format: 'flat' })
  }

  public async getTaxCodeName(settings: any) {
    const smartBillAuthorization = Smartbill.getBuffer(settings)

    return this.http.get(`/tax?cif=${settings.smarbillVatCode}`, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Vtex-Use-Https': true,
        Authorization: `Basic ${smartBillAuthorization}`,
      },
    })

  }

  private generateTaxName(taxes: any[], value: string | number) {

    return taxes.find((item: TaxName) => item.percentage === parseInt(value as string, 10))?.name
  }


  public async generateProducts(order: any, settings: any) {
    const productTaxNames = await this.getTaxCodeName(settings)

    let items = order.items.map((item: any) => {
      const taxCode = item.taxCode || settings.smartbillDefaultVATPercentage
      let vatPercent = taxCode

      if (settings.useVtexProductTaxValue) {
        vatPercent = item.priceTags.reduce((result: any, tag: any) => {

          if (tag.isPercentual) {
            result = tag.value
          }

          return result
        },
          taxCode)
      }

      const taxName = this.generateTaxName(productTaxNames.taxes, vatPercent)

      return {
        code: item.uniqueId,
        currency: order.storePreferencesData.currencyCode,
        isTaxIncluded: true,
        measuringUnitName: constants.measuringUnitName,
        name: item.name,
        price: item.sellingPrice,
        quantity: item.quantity,
        taxName,
        taxPercentage: vatPercent,
      }
    })


    if(order.changesAttachment) {
      order.changesAttachment.changesData.forEach((change: any) => {
        if(change.itemsAdded) {
          change.itemsAdded.forEach((item: any) => {
            const orderProduct = items.filter((prod: any) => prod.id === item.id && prod.price === item.price);

            if(orderProduct.length) {
              let [currentProduct] = orderProduct;

              currentProduct = {
                ...currentProduct,
                quantity: currentProduct.quantity + item.quantity
              }
              items = mergeArrays(items, currentProduct);
            } else {
              const currentProduct = {
                id: item.id,
                code: Math.floor(Math.random() * 100),
                currency: order.storePreferencesData.currencyCode,
                isTaxIncluded: true,
                measuringUnitName: 'buc',
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                taxName: 'tax',
                taxPercentage: settings.smartbillDefaultVATPercentage
              }

              items.push(currentProduct);
            }


          })
        }

        if(change.itemsRemoved) {
          change.itemsRemoved.forEach((item: any) => {
            const orderProduct = items.filter((prod: any) => prod.id === item.id && prod.price === item.price);

            if(orderProduct.length) {
              let [currentProduct] = orderProduct;

              if(currentProduct.quantity - item.quantity) {
                currentProduct = {
                  ...currentProduct,
                  quantity: currentProduct.quantity - item.quantity
                }
                items = mergeArrays(items, currentProduct);
              } else {
                items = items.filter((product: any) => product.id !== item.id)
              }

            }
          })
        }
      })
    }

    if (
      settings.invoiceShippingCost &&
      // eslint-disable-next-line no-prototype-builtins
      order.hasOwnProperty('shippingTotal') &&
      order.shippingTotal > 0
    ) {

      const taxName = this.generateTaxName(productTaxNames.taxes, settings.smartbillDefaultVATPercentage)

      items.push({
        code: settings.invoiceShippingProductCode,
        currency: order.storePreferencesData.currencyCode,
        isTaxIncluded: true,
        measuringUnitName: 'buc',
        name: settings.invoiceShippingProductName,
        price: order.shippingTotal,
        quantity: 1,
        taxName,
        taxPercentage: settings.smartbillDefaultVATPercentage,
        isService: true,
      })
    }

    return items
  }

  constructor(context: IOContext, options?: InstanceOptions) {
    super(constants.smartbillEndpoint, context, options)
  }

  public async getSettings() {
    const apps = new Apps(this.context)
    const appId = process.env.VTEX_APP_ID as string

    return apps.getAppSettings(appId)
  }

  public async showInvoice(invoiceNumber: any): Promise<any> {
    const settings = await this.getSettings()

    const smartBillAuthorization = Smartbill.getBuffer(settings)

    return this.http.getStream(
      `/invoice/pdf?cif=${settings.smarbillVatCode}&seriesname=${settings.smarbillSeriesName}&number=${invoiceNumber}`,
      {
        headers: {
          Accept: 'application/octet-stream',
          'Content-Type': 'application/xml',
          'X-Vtex-Use-Https': true,
          Authorization: `Basic ${smartBillAuthorization}`,
        },
      }
    )
  }

  public async getEncryptedNumber(
    body: any,
    address?: AddressForm
  ): Promise<any> {

    const settings = await this.getSettings()
    const response = await this.generateInvoice(body, address)

    const simpleCrypto = new SimpleCrypto(settings.smarbillApiToken)

    const cipherText = simpleCrypto.encrypt(
      JSON.stringify({ number: response.number })
    )

    response.encryptedNumber = Buffer.from(cipherText).toString('base64')

    return response
  }

  public async generateInvoice(body: any, address?: AddressForm): Promise<any> {
    const errors = await this.validateSettings()

    if (errors) {
      throw new Error(JSON.stringify(errors))
    }

    const { order } = body
    const json = await this.generateJson(order, address)

    const settings = await this.getSettings()
    const smartBillAuthorization = Smartbill.getBuffer(settings)

    return this.http.post('/invoice', json, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Vtex-Use-Https': true,
        Authorization: `Basic ${smartBillAuthorization}`,
      },
    })
  }
}

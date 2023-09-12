/* eslint-disable  @typescript-eslint/no-explicit-any */
// eslint-disable-next-line prettier/prettier
import type { InstanceOptions, IOContext } from '@vtex/api'
import SimpleCrypto from 'simple-crypto-js'
import { Apps, ExternalClient } from '@vtex/api'
import { validate } from 'validate.js'

import constants, { settings as settingsConstants } from '../constants'
import type { AddressForm, TaxName } from '../typings'

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
      orderId,
    } = order

    const clientEntity = await this.getClient(client.userProfileId)
    const email = clientEntity.length ? clientEntity[0].email : client.email

    const clientData: any = {
      country: constants.country,
      email,
      name: `${client.lastName} ${client.firstName}`,
      address: addressForm?.corporateAddress
        ? addressForm.corporateAddress
        : `${address.street} ${address.number}`,
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
      mentions: `ID factura: ${orderId}`,
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
    return taxes.find(
      (item: TaxName) => item.percentage === parseInt(value as string, 10)
    )?.name
  }

  public async generateProducts(order: any, settings: any) {
    const productTaxNames = await this.getTaxCodeName(settings)

    const items: any[] = []

    order.items.forEach((item: any) => {
      const taxCode = item.taxCode || settings.smartbillDefaultVATPercentage
      let vatPercent = taxCode

      if (settings.useVtexProductTaxValue) {
        vatPercent = item.priceTags.reduce((result: any, tag: any) => {
          if (tag.isPercentual) {
            result = tag.value
          }

          return result
        }, taxCode)
      }

      const taxName = this.generateTaxName(productTaxNames.taxes, vatPercent)
      const skuName = order?.itemMetadata?.Items?.find(
        (itemMetaData: any) => itemMetaData.Id === item.id
      )?.SkuName

      items.push({
        code: item.uniqueId,
        currency: order.storePreferencesData.currencyCode,
        isTaxIncluded: true,
        measuringUnitName: constants.measuringUnitName,
        name: skuName ?? item.name,
        price: item.listPrice,
        quantity: item.quantity,
        taxName,
        taxPercentage: vatPercent,
      })

      if (item.discount && item.discount > 0) {
        items.push({
          code: item.uniqueId,
          currency: order.storePreferencesData.currencyCode,
          isTaxIncluded: true,
          measuringUnitName: constants.measuringUnitName,
          name: `Reducere ${skuName}`,
          numberOfItems: 1,
          taxName,
          taxPercentage: vatPercent,
          isDiscount: true,
          discountType: 1,
          discountValue: -item.discount * item.quantity,
        })
      }
    })

    const taxName = this.generateTaxName(
      productTaxNames.taxes,
      settings.smartbillDefaultVATPercentage
    )

    // Here we tackle the situation where there is only a value change
    if (order.changesAttachment) {
      order.changesAttachment.changesData.forEach((change: ChangesDataItem) => {
        const {
          itemsRemoved,
          itemsAdded,
          reason,
          discountValue,
          incrementValue,
        } = change

        if (!itemsRemoved?.length && !itemsAdded?.length) {
          const isDiscount = Boolean(discountValue)

          items.push({
            code: settings.invoiceChangesProductCode,
            currency: order.storePreferencesData.currencyCode,
            isTaxIncluded: true,
            measuringUnitName: constants.measuringUnitName,
            name: reason,
            quantity: 1,
            taxName,
            taxPercentage: settings.smartbillDefaultVATPercentage,
            ...(isDiscount
              ? {
                  isDiscount,
                  discountType: 1,
                  discountValue:
                    -discountValue /
                    settingsConstants.constants.price_multiplier,
                }
              : {
                  quantity: 1,
                  price:
                    incrementValue /
                    settingsConstants.constants.price_multiplier,
                }),
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

    const discounts =
      order.ratesAndBenefitsData.rateAndBenefitsIdentifiers.reduce(
        (acc: any, { id, name, quantity }: any) => {
          let value = 0

          order.items.forEach((item: any) => {
            if (item.priceTags?.length) {
              const currentTag = item.priceTags.find(
                (tag: any) => tag.identifier === id
              )

              if (currentTag && currentTag.value !== 0) {
                value += currentTag.value as number
              }
            }
          })

          return [...acc, { id, value, name, quantity }]
        },
        []
      )

    discounts.forEach(({ id, name, value }: any) => {
      if (value !== 0) {
        items.push({
          code: id,
          currency: order.storePreferencesData.currencyCode,
          isTaxIncluded: true,
          measuringUnitName: constants.measuringUnitName,
          name,
          numberOfItems: 1,
          taxName,
          taxPercentage: settings.smartbillDefaultVATPercentage,
          isDiscount: true,
          discountType: 1,
          discountValue: value / settingsConstants.constants.price_multiplier,
        })
      }
    })

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

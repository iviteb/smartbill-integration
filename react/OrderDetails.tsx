import React, { Component } from 'react'
import { Box, Button, Card, Collapsible, Modal, Tag } from 'vtex.styleguide'
import { FormattedCurrency } from 'vtex.format-currency'
import PropTypes from 'prop-types'
import { defineMessages, FormattedMessage } from 'react-intl'
import axios from 'axios'

import settings from './settings'
import styles from './style.css'
import { defaultAWBFormat, requestHeaders } from './utils/constants'

const messages = defineMessages({
  order: { id: 'admin/order.order' },
  requestAwb: { id: 'admin/order.request-awb' },
  company: { id: 'admin/order.company' },
  tradeRegister: { id: 'admin/order.trade-register' },
  readyToHandle: { id: 'admin/order.status.ready-to-handle' },
  startHandling: { id: 'admin/order.status.start-handling' },
  automatic: { id: 'admin/order.automatic' },
  rate: { id: 'admin/order.rate' },
  rateVat: { id: 'admin/order.rate-vat' },
  service: { id: 'admin/order.service' },
  deliveryDays: { id: 'admin/order.delivery-days' },
  autoWeight: { id: 'admin/order.auto-weight-distribution' },
  numberParcels: { id: 'admin/order.number-of-parcels' },
  totalWeight: { id: 'admin/order.total-weight' },
  recipientSupport: { id: 'admin/order.recipient-support' },
  seeOrderDetails: { id: 'admin/order.see-order-details' },
  trackingNumberIs: { id: 'admin/order.tracking-number-is' },
  printLabel: { id: 'admin/order.print-label' },
  awbStatus: { id: 'admin/order.awb-status' },
  updateAwbStatus: { id: 'admin/order.update-awb-status' },
  paymentMethod: { id: 'admin/order.payment-method' },
  productId: { id: 'admin/order.product-id' },
  skuRefCode: { id: 'admin/order.sku-ref-code' },
  weight: { id: 'admin/order.weight' },
  moreDetails: { id: 'admin/order.more-details' },
  shippingTotal: { id: 'admin/order.shipping-total' },
  giftCard: { id: 'admin/order.gift-card' },
  totalOrderValue: { id: 'admin/order.total-order-value' },
  shippingInformation: { id: 'admin/order.shipping-information' },
  invoicingInformation: { id: 'admin/order.invoicing-information' },
  client: { id: 'admin/order.client' },
  phone: { id: 'admin/order.phone' },
  shippingStatus: { id: 'admin/order.shipping-status' },
  theOrderIs: { id: 'admin/order.the-order-is' },
  close: { id: 'admin/order.close' },
  errors: { id: 'admin/order.errors' },
})

function FormattedMessageFixed(props) {
  return <FormattedMessage {...props} />
}

class OrderDetails extends Component<any, any> {
  static propTypes = {
    order: PropTypes.object,
    intl: PropTypes.object,
    logError: PropTypes.func,
  }

  constructor(props: any) {
    super(props)
    this.state = {
      order: this.props.order,
      posted: false,
      errors: {},
      error: {},
      modalOpen: false,
      productsSpecs: [],
      changedItems: {},
      totalOrderDiscount: 0,
      giftCards: [],
      numberOfParcels: 1,
      totalWeight: 0,
      parcelWeights: [],
      quantityWeights: [],
      format: defaultAWBFormat,
      priceRates: [],
      shipmentPayment: 0,
      shipmentPaymentMethod: 1,
      selectedShippingCostCard: 'auto',
      courierId: null,
      canSubmit: true,
      parcelWeightsErrors: [],
      collapsibles: {},
    }
    this.closeModal = this.closeModal.bind(this)
    this.getOrder = this.getOrder.bind(this)
    this.collapse = this.collapse.bind(this)
  }

  collapse(itemId, state) {
    const { collapsibles } = this.state

    collapsibles[itemId] = state
    this.setState({ collapsibles })
  }

  async initOrderChangesAndDiscounts() {
    const { order, changedItems, giftCards } = this.state
    let { totalOrderDiscount } = this.state

    if (order.paymentData.giftCards.length) {
      totalOrderDiscount += order.paymentData.transactions[0].payments.reduce(
        function (result, it) {
          if (it.redemptionCode) {
            result -= it.value
            giftCards.push({
              code: it.redemptionCode,
              value: -it.value / settings.constants.price_multiplier,
            })
          }

          return result
        },
        0
      )

      this.setState({ totalOrderDiscount, giftCards })
    }

    if (order.changesAttachment) {
      order.changesAttachment.changesData.map(item => {
        if (item.itemsAdded.length) {
          item.itemsAdded.map(added => {
            let val = 0

            if (added.id in changedItems) {
              val = changedItems[added.id]
            }

            changedItems[added.id] = val + added.quantity

            const existingProduct = order.items.filter(item => {
              return item.id === added.id
            })

            if (!existingProduct.length) {
              fetch(`/smartbill/catalog/stockkeepingunit/${added.id}`)
                .then(resp => resp.json())
                .then(async json => {
                  let imageUrl = ''

                  const variations = await fetch(
                    `/smartbill/catalog/product-variation/${json.ProductId}`
                  ).then(response => response.json())

                  const existingSku = variations.skus.filter(sku => {
                    return sku.sku == added.id
                  })

                  if (existingSku.length) {
                    imageUrl = existingSku[0].image
                  }

                  order.items.push({
                    uniqueId: json.RefId,
                    name: json.Name,
                    refId: json.RefId,
                    productId: json.ProductId,
                    id: json.Id,
                    additionalInfo: {
                      dimension: {
                        cubicweight: json.CubicWeight,
                        weight: json.WeightKg,
                        height: json.Height,
                        length: json.Length,
                        width: json.Width,
                      },
                    },
                    measurementUnit: json.MeasurementUnit,
                    tax: 0,
                    price: added.price,
                    listPrice: added.price,
                    sellingPrice: added.price,
                    quantity: added.quantity,
                    imageUrl,
                    unitMultiplier: added.unitMultiplier,
                    priceTags: [],
                  })
                })
            }
          })
        }

        if (item.itemsRemoved.length) {
          item.itemsRemoved.map(removed => {
            let val = 0

            if (removed.id in changedItems) {
              val = changedItems[removed.id]
            }

            changedItems[removed.id] = val - removed.quantity
          })
        }
      })

      this.setState({ changedItems, totalOrderDiscount, order })
    }
  }

  initOrderWeight() {
    const { order } = this.state

    let trackingNumber

    if (
      order.packageAttachment.packages &&
      order.packageAttachment.packages.length
    ) {
      const packageItem = order.packageAttachment.packages[0]

      trackingNumber = packageItem.trackingNumber
    }

    if (!trackingNumber && order.status === settings.constants.invoiced) {
      const totalWeight = order.items.reduce(function (result, item) {
        result += item.additionalInfo.dimension.weight * item.quantity

        return result
      }, 0)

      this.setState({ totalWeight })
    }
  }

  componentDidMount() {
    this.initOrderChangesAndDiscounts()
    this.initOrderWeight()
  }

  async getOrder() {
    const { order } = this.state

    return await fetch(
      `/api/oms/pvt/orders/${order.orderId}/?_=${Date.now()}`,
      {
        headers: requestHeaders,
      }
    )
      .then(res => res.json())
      .then(json => this.setState({ order: json }))
  }

  closeModal() {
    this.setState({ modalOpen: false, errors: {}, error: {}, posted: false })
  }

  changeState(newState) {
    this.setState({ posted: true })
    try {
      const { order } = this.state

      axios
        .post(`/api/oms/pvt/orders/${order.orderId}/changestate/${newState}`)
        .then(() => {
          window.location.reload()
        })
    } catch (err) {
      this.setState({ posted: false })
    }
  }

  handleOrder() {
    this.setState({ posted: true })
    try {
      const { order } = this.state

      axios
        .post(`/api/oms/pvt/orders/${order.orderId}/start-handling`)
        .then(() => {
          window.location.reload()
        })
    } catch (err) {
      this.setState({ posted: false })
    }
  }

  public render() {
    const {
      order,
      errors,
      error,
      totalOrderDiscount,
      giftCards,
      quantityWeights,
      collapsibles,
    } = this.state

    let { totalWeight } = this.state
    const { formatMessage } = this.props.intl

    if (!order.hasOwnProperty('error')) {
      let button
      let shipping = 0
      let displayError
      let displayShippingInformation
      let displayCorporateInformation

      const orderValue = order.value

      displayShippingInformation = (
        <div className={`${styles.shippingInformationHolder}`}>
          <span>
            {order.shippingData.address.street},{' '}
            {order.shippingData.address.number}
          </span>
          <span>
            {order.shippingData.address.city},{' '}
            {order.shippingData.address.state},{' '}
            {order.shippingData.address.postalCode}
          </span>
        </div>
      )

      if (order.shippingData.address.addressType === 'pickup') {
        displayShippingInformation = (
          <div className={`${styles.shippingInformationHolder}`}>
            <span className={`${styles.bold}`}>
              {order.shippingData.logisticsInfo[0].pickupStoreInfo.friendlyName}
            </span>
            <span>
              {order.shippingData.address.street},{' '}
              {order.shippingData.address.number}
            </span>
            <span>
              {order.shippingData.address.city},{' '}
              {order.shippingData.address.state},{' '}
              {order.shippingData.address.postalCode}
            </span>
          </div>
        )
      }

      if (order.clientProfileData.isCorporate) {
        displayCorporateInformation = (
          <div className={`${styles.corporateInformationHolder}`}>
            <span className={`${styles.bold}`}>
              {formatMessage({ id: messages.company.id })}:{' '}
              {order.clientProfileData.corporateName}
            </span>
            <span className={`${styles.bold}`}>
              {formatMessage({ id: messages.tradeRegister.id })}:{' '}
              {order.clientProfileData.corporateDocument}
            </span>
          </div>
        )
      }

      const ship = order.totals.filter(function (item) {
        return item.id === settings.constants.shipping
      })

      if (ship.length) {
        shipping = ship[0].value
      }

      if (this.state.error.hasOwnProperty('message')) {
        displayError = <li>{error.message}</li>
      }

      const messageId = `admin/order.status.${order.status}`

      const tagColor =
        order.status === settings.constants.invoiced ? 'blue' : 'green'

      if (order.status === settings.constants.window_to_cancel) {
        button = (
          <Button
            onClick={() => this.changeState('ready-for-handling')}
            isLoading={this.state.posted}
            variation="primary"
            block
          >
            Ready to handle
          </Button>
        )
      } else if (order.status === settings.constants.ready_for_handling) {
        button = (
          <Button
            onClick={() => this.handleOrder()}
            isLoading={this.state.posted}
            variation="primary"
            block
          >
            Start handling
          </Button>
        )
      } else if (order.status === settings.constants.invoiced) {
        button = (
          <Button
            target="_blank"
            href={`/admin/checkout/#/orders/${order.orderId}`}
            variation="primary"
            block
          >
            {formatMessage({ id: messages.seeOrderDetails.id })}
          </Button>
        )
      }

      return (
        <div className={`pa6 ${styles.flex05}`}>
          <Box
            title={`${formatMessage({ id: messages.order.id })}#${order.orderId
              }`}
          >
            <div className={`flex flex-row ${styles.flex1}`}>
              <div>
                <Tag bgColor={tagColor} color="#fff">
                  <span className="nowrap">
                    <FormattedMessageFixed id={messageId} />
                  </span>
                </Tag>
              </div>
              <div className="ml2">
                <Tag bgColor="green" color="#fff">
                  <span className="nowrap">
                    {formatMessage({ id: messages.paymentMethod.id })} -{' '}
                    {
                      order.paymentData.transactions[0].payments[0]
                        .paymentSystemName
                    }
                  </span>
                </Tag>
              </div>
            </div>

            <div className={`mt4 ${styles.orderDetailsCard}`}>
              <Card>
                <div className={`flex flex-row ${styles.flex1}`}>
                  <div className={`flex flex-column ${styles.flex08}`}>
                    <div>
                      {order.items.map((item, i) => {
                        const qOptions = [] as any
                        const { sellingPrice } = item
                        const taxPrice = item.tax

                        const { weight } = item.additionalInfo.dimension
                        let { quantity } = item

                        if (item.id in this.state.changedItems) {
                          if (this.state.changedItems[item.id] < 0) {
                            quantity += this.state.changedItems[item.id]
                          }

                          if (!quantity) {
                            return false
                          }
                        }

                        for (let i = 1; i <= quantity; i++) {
                          qOptions.push({ value: i, label: i })
                        }

                        totalWeight += weight * quantity
                        const { productsSpecs } = this.state

                        fetch(
                          `/api/catalog_system/pvt/products/${item.productId}/specification`
                        )
                          .then(res => res.json())
                          .then(json => {
                            const specs = json.reduce((result, item) => {
                              if (item.Value[0] !== '') {
                                result = (
                                  <div>
                                    {result}
                                    <span className={`${styles.productSpec}`}>
                                      {item.Name}: {item.Value[0]}
                                    </span>
                                  </div>
                                )
                              }

                              return result
                            }, null)

                            if (productsSpecs[item.productId] === undefined) {
                              productsSpecs[item.productId] = specs
                              quantityWeights[quantity] = weight * quantity
                              this.setState({ productsSpecs, quantityWeights })
                            }
                          })

                        return (
                          <div
                            key={i}
                            className={`pa2 flex flex-row ${styles.flex1}`}
                          >
                            <div className={`${styles.flex01}`}>
                              <img src={item.imageUrl} alt="Image" />
                            </div>

                            <div
                              className={`flex flex-column ${styles.flex05}`}
                            >
                              <span
                                className={`${styles.productInfo} ${styles.bold}`}
                              >
                                {formatMessage({ id: messages.productId.id })}
                                {': '} #{item.productId}
                              </span>
                              <span
                                className={`${styles.productInfo} ${styles.bold}`}
                              >
                                {formatMessage({ id: messages.skuRefCode.id })}
                                {': '} #{item.refId}
                              </span>
                              <span className={`${styles.productInfo}`}>
                                {item.name}
                              </span>
                              <span className={`${styles.productInfo}`}>
                                {formatMessage({ id: messages.weight.id })}
                                {': '} {weight}kg x {quantity}
                                {item.measurementUnit} = {weight * quantity}kg
                              </span>
                              <div className={`${styles.productInfo}`}>
                                {productsSpecs[item.productId] ? (
                                  <Collapsible
                                    header={
                                      <span>
                                        {formatMessage({
                                          id: messages.moreDetails.id,
                                        })}
                                      </span>
                                    }
                                    onClick={e =>
                                      this.collapse(
                                        item.productId,
                                        e.target.isOpen
                                      )
                                    }
                                    isOpen={
                                      collapsibles.hasOwnProperty(
                                        item.productId
                                      )
                                        ? collapsibles[item.productId]
                                        : false
                                    }
                                    caretColor="primary"
                                  >
                                    {productsSpecs[item.productId]}
                                  </Collapsible>
                                ) : null}
                              </div>
                              <span className={`${styles.productInfo}`}>
                                {quantity} {item.measurementUnit}
                              </span>
                              <span className={`${styles.productInfo}`}>
                                <FormattedCurrency
                                  value={
                                    (sellingPrice + taxPrice) /
                                    settings.constants.price_multiplier
                                  }
                                />
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div
                      className={`flex flex-column ${styles.orderDetailsTotals}`}
                    >
                      <span>
                        {formatMessage({ id: messages.shippingTotal.id })}
                        {': '}
                        <FormattedCurrency
                          value={shipping / settings.constants.price_multiplier}
                        />
                      </span>
                      {giftCards.map((item, i) => {
                        return (
                          <span key={i}>
                            {formatMessage({ id: messages.giftCard.id })}
                            {': '} <FormattedCurrency value={item.value} /> (
                            {item.code})
                          </span>
                        )
                      })}
                      <span>
                        {formatMessage({ id: messages.totalOrderValue.id })}
                        {': '}
                        <FormattedCurrency
                          value={
                            (orderValue + totalOrderDiscount) /
                            settings.constants.price_multiplier
                          }
                        />
                      </span>
                    </div>
                  </div>
                  <div className={`flex flex-column ${styles.flex03}`}>
                    <span
                      className={`${styles.shippingInfoTitle} ${styles.bold}`}
                    >
                      {formatMessage({ id: messages.invoicingInformation.id })}
                    </span>
                    <span className={`${styles.shippingInfoText}`}>
                      {formatMessage({ id: messages.client.id })}
                      {': '} {order.shippingData.address.receiverName}
                    </span>
                    <span className={`${styles.shippingInfoText}`}>
                      {formatMessage({ id: messages.phone.id })}
                      {': '} {order.clientProfileData.phone}
                    </span>
                    {displayShippingInformation}
                    {displayCorporateInformation}
                  </div>
                </div>
              </Card>
            </div>

            <div className="mb4 mt4">{button}</div>
          </Box>

          <Modal
            centered
            isOpen={this.state.modalOpen}
            onClose={this.closeModal}
            bottomBar={
              <div className="nowrap">
                <span className="mr4">
                  <Button
                    variation="danger"
                    size="small"
                    onClick={this.closeModal}
                  >
                    {formatMessage({ id: messages.close.id })}
                  </Button>
                </span>
              </div>
            }
          >
            <div>
              <p className="f3 f3-ns fw3 gray">
                {formatMessage({ id: messages.errors.id })}
              </p>
              <ul>
                {Object.keys(errors).map(function (key) {
                  if (errors[key].hasOwnProperty('details')) {
                    return errors[key].details.map(msg => {
                      return <li key={key}>{msg}</li>
                    })
                  }

                  return <li key={key}>{errors[key][0]}</li>
                })}
                {displayError}
              </ul>
            </div>
          </Modal>
        </div>
      )
    }

    return null
  }
}

export default OrderDetails
